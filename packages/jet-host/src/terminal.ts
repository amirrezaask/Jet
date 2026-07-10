import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { IPty } from "node-pty"
import { spawn as spawnPty } from "node-pty"
import { fileUriToPath } from "@jet/shared"
import { sendToClient } from "./host-renderer.js"
import type { HostRegistry } from "./registry.js"

type TerminalEntry = {
  pty: IPty | null
  clientId: string
  cwd: string
  shellTitleBase?: string
  shellTitleIndex?: number
  title?: string
  status: "running" | "exited"
  exitCode?: number
  signal?: number
  output: string
  sequence: number
}

const terminals = new Map<string, TerminalEntry>()
let terminalSequence = 0
const MAX_TERMINAL_REPLAY_CHARS = 4 * 1024 * 1024

function disposeTerminal(id: string): void {
  const entry = terminals.get(id)
  if (!entry) return
  terminals.delete(id)
  try {
    entry.pty?.kill()
  } catch {
    // pty may already be dead
  }
}

export function disposeTerminalsForClient(clientId: string): void {
  for (const [id, entry] of terminals) {
    if (entry.clientId === clientId) disposeTerminal(id)
  }
}

function sendTerminalData(entry: TerminalEntry, id: string, data: string): void {
  entry.sequence += 1
  entry.output += data
  if (entry.output.length > MAX_TERMINAL_REPLAY_CHARS) {
    entry.output = entry.output.slice(entry.output.length - MAX_TERMINAL_REPLAY_CHARS)
  }
  sendToClient(entry.clientId, "terminal:data", id, data, entry.sequence)
}

function sendTerminalExit(entry: TerminalEntry, id: string, exitCode: number, signal?: number): void {
  sendToClient(entry.clientId, "terminal:exit", id, exitCode, signal)
}

type ShellSpec = { file: string; args: string[] }

function primaryShell(): ShellSpec {
  if (process.platform === "win32") {
    return { file: process.env.COMSPEC || "powershell.exe", args: [] }
  }
  const file = process.env.SHELL || "/bin/zsh"
  if (file.endsWith("zsh") || file.endsWith("bash")) {
    return { file, args: ["-il"] }
  }
  return { file, args: [] }
}

function fallbackShells(primary: ShellSpec): ShellSpec[] {
  if (process.platform === "win32") return []
  const alt: ShellSpec[] = []
  if (primary.file !== "/bin/zsh") alt.push({ file: "/bin/zsh", args: ["-il"] })
  if (primary.file !== "/bin/bash") alt.push({ file: "/bin/bash", args: ["-il"] })
  alt.push({ file: "/bin/sh", args: [] })
  return alt
}

function nextShellTitle(cwd: string, shellFile: string): {
  base: string
  index: number
  title: string
} {
  const base = path.basename(shellFile).replace(/\.exe$/i, "") || "shell"
  const used = new Set<number>()
  for (const entry of terminals.values()) {
    if (entry.cwd !== cwd || entry.shellTitleBase !== base) continue
    if (entry.shellTitleIndex) used.add(entry.shellTitleIndex)
  }
  let index = 1
  while (used.has(index)) index += 1
  return { base, index, title: index === 1 ? base : `${base} ${index}` }
}

function resolveCwd(cwdUri: string): string {
  let cwd = ""
  try {
    cwd = fileUriToPath(cwdUri)
  } catch {
    return os.homedir()
  }
  try {
    if (!fs.statSync(cwd).isDirectory()) return os.homedir()
  } catch {
    return os.homedir()
  }
  return cwd
}

export function registerTerminalHandlers(registry: HostRegistry): void {
  registry.handle("terminal:create", async (args, ctx) => {
    const cwdUri = args[0] as string
    const launch = args[1] as { command: string; args?: string[] } | undefined
    if (typeof cwdUri !== "string" || cwdUri.length > 32_768) {
      throw new Error("Invalid terminal working directory")
    }
    if (launch && (
      typeof launch.command !== "string" ||
      launch.command.length === 0 ||
      launch.command.length > 4_096 ||
      (launch.args != null && (!Array.isArray(launch.args) || launch.args.some(arg => typeof arg !== "string" || arg.length > 8_192)))
    )) {
      throw new Error("Invalid terminal launch command")
    }
    const id = `term-${Date.now()}-${++terminalSequence}`
    const primary = launch
      ? { file: launch.command, args: launch.args ?? [] }
      : primaryShell()
    const cwd = resolveCwd(cwdUri)
    const env = {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      HOME: process.env.HOME || os.homedir(),
    } as Record<string, string>

    const attempts: ShellSpec[] = launch ? [primary] : [primary, ...fallbackShells(primary)]
    let pty: IPty | null = null
    let usedShell: ShellSpec | null = null
    const errors: string[] = []
    for (const attempt of attempts) {
      try {
        pty = spawnPty(attempt.file, attempt.args, {
          name: "xterm-256color",
          cwd,
          env,
          cols: 80,
          rows: 24,
        })
        usedShell = attempt
        break
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        errors.push(`${attempt.file}: ${message}`)
      }
    }
    if (!pty || !usedShell) {
      throw new Error(`Failed to spawn shell in ${cwd}. Attempts: ${errors.join(" | ")}`)
    }

    const shellTitle = launch ? null : nextShellTitle(cwd, usedShell.file)
    terminals.set(id, {
      pty,
      clientId: ctx.clientId,
      cwd,
      shellTitleBase: shellTitle?.base,
      shellTitleIndex: shellTitle?.index,
      title: shellTitle?.title,
      status: "running",
      output: "",
      sequence: 0,
    })
    pty.onData(data => {
      const entry = terminals.get(id)
      if (!entry) return
      sendTerminalData(entry, id, data)
    })
    pty.onExit(({ exitCode, signal }) => {
      const entry = terminals.get(id)
      if (entry) sendTerminalExit(entry, id, exitCode, signal)
      if (entry) {
        entry.pty = null
        entry.status = "exited"
        entry.exitCode = exitCode
        entry.signal = signal
      }
    })
    return { id, title: shellTitle?.title }
  })

  registry.handle("terminal:write", async args => {
    const id = args[0] as string
    const data = args[1] as string
    if (typeof id !== "string" || typeof data !== "string" || data.length > 1024 * 1024) return
    terminals.get(id)?.pty?.write(data)
  })

  registry.handle("terminal:resize", async args => {
    const id = args[0] as string
    const cols = args[1] as number
    const rows = args[2] as number
    if (typeof id !== "string" || !Number.isFinite(cols) || !Number.isFinite(rows)) return
    const entry = terminals.get(id)
    if (!entry) return
    if (cols > 0 && rows > 0) entry.pty?.resize(
      Math.min(1_000, Math.floor(cols)),
      Math.min(1_000, Math.floor(rows)),
    )
  })

  registry.handle("terminal:attach", async (args, ctx) => {
    const id = args[0] as string
    if (typeof id !== "string" || id.length > 256) return null
    const entry = terminals.get(id)
    if (!entry || entry.clientId !== ctx.clientId) return null
    return {
      id,
      title: entry.title,
      output: entry.output,
      lastSequence: entry.sequence,
      status: entry.status,
      exitCode: entry.exitCode,
      signal: entry.signal,
    }
  })

  registry.handle("terminal:dispose", async args => {
    const id = args[0] as string
    if (typeof id !== "string" || id.length > 256) return
    disposeTerminal(id)
  })
}

export function stopAllTerminals() {
  for (const id of [...terminals.keys()]) disposeTerminal(id)
}
