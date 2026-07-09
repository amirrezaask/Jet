import type { IpcMain, WebContents } from "electron"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { IPty } from "node-pty"
import { spawn as spawnPty } from "node-pty"
import { fileUriToPath } from "@jet/shared"

type TerminalEntry = {
  pty: IPty
  webContents: WebContents
  cwd: string
  shellTitleBase?: string
  shellTitleIndex?: number
}

const terminals = new Map<string, TerminalEntry>()
const terminalWebContents = new WeakSet<WebContents>()
let terminalSequence = 0

function disposeTerminal(id: string): void {
  const entry = terminals.get(id)
  if (!entry) return
  terminals.delete(id)
  try {
    entry.pty.kill()
  } catch {
    // pty may already be dead
  }
}

function disposeTerminalsForWebContents(webContents: WebContents): void {
  for (const [id, entry] of terminals) {
    if (entry.webContents === webContents) disposeTerminal(id)
  }
}

function sendTerminalData(entry: TerminalEntry, id: string, data: string): void {
  if (entry.webContents.isDestroyed()) {
    disposeTerminal(id)
    return
  }
  try {
    entry.webContents.send("terminal:data", id, data)
  } catch {
    disposeTerminal(id)
  }
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

export function registerTerminalHandlers(ipcMain: IpcMain) {
  ipcMain.handle("terminal:create", async (
    event,
    cwdUri: string,
    launch?: { command: string; args?: string[] },
  ) => {
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

    const webContents = event.sender
    const shellTitle = launch ? null : nextShellTitle(cwd, usedShell.file)
    terminals.set(id, {
      pty,
      webContents,
      cwd,
      shellTitleBase: shellTitle?.base,
      shellTitleIndex: shellTitle?.index,
    })
    if (!terminalWebContents.has(webContents)) {
      terminalWebContents.add(webContents)
      webContents.once("destroyed", () => disposeTerminalsForWebContents(webContents))
    }
    pty.onData(data => {
      const entry = terminals.get(id)
      if (!entry) return
      sendTerminalData(entry, id, data)
    })
    pty.onExit(() => {
      terminals.delete(id)
    })
    return { id, title: shellTitle?.title }
  })

  ipcMain.handle("terminal:write", async (_e, id: string, data: string) => {
    terminals.get(id)?.pty.write(data)
  })

  ipcMain.handle("terminal:resize", async (_e, id: string, cols: number, rows: number) => {
    const entry = terminals.get(id)
    if (!entry) return
    if (cols > 0 && rows > 0) entry.pty.resize(cols, rows)
  })

  ipcMain.handle("terminal:dispose", async (_e, id: string) => {
    disposeTerminal(id)
  })
}

export function stopAllTerminals() {
  for (const id of [...terminals.keys()]) disposeTerminal(id)
}

export { disposeTerminalsForWebContents }
