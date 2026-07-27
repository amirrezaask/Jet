import * as pty from "node-pty"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { uriToPath } from "./paths.js"

const MAX_TERMINAL_REPLAY = 2 * 1024 * 1024
const MAX_WRITE_BYTES = 1024 * 1024

export type TerminalLaunch = {
  command: string
  args?: string[]
}

export type TerminalCreateResult = {
  id: string
  title: string | null
}

export type TerminalAttachSnapshot = {
  id: string
  title: string | null
  output: string
  lastSequence: number
  status: "running" | "exited"
  exitCode: number | null
  signal: string | null
}

type EmitFn = (channel: string, args: unknown[]) => void

type TerminalEntry = {
  id: string
  title: string | null
  clientId: string
  status: "running" | "exited"
  exitCode: number | null
  signal: string | null
  sequence: number
  output: string[]
  outputBytes: number
  proc: pty.IPty | null
}

function defaultShell(): { command: string; args: string[] } {
  const shell = process.env.SHELL || (process.platform === "win32" ? "powershell.exe" : "/bin/zsh")
  if (process.platform === "win32") return { command: shell, args: [] }
  const base = path.basename(shell)
  if (base === "zsh" || base === "bash") return { command: shell, args: ["-il"] }
  return { command: shell, args: [] }
}

function shellFallbacks(): string[] {
  if (process.platform === "win32") return ["powershell.exe", "cmd.exe"]
  return ["/bin/zsh", "/bin/bash", "/bin/sh"]
}

function trimReplay(entry: TerminalEntry): void {
  while (entry.outputBytes > MAX_TERMINAL_REPLAY && entry.output.length > 1) {
    const dropped = entry.output.shift()!
    entry.outputBytes -= Buffer.byteLength(dropped, "utf8")
  }
  if (entry.outputBytes > MAX_TERMINAL_REPLAY && entry.output.length === 1) {
    const only = entry.output[0]!
    let bytes = Buffer.byteLength(only, "utf8")
    let start = 0
    while (bytes > MAX_TERMINAL_REPLAY && start < only.length) {
      const cp = only.codePointAt(start) ?? 0
      const width = cp > 0xffff ? 2 : 1
      bytes -= Buffer.byteLength(only.slice(start, start + width), "utf8")
      start += width
    }
    entry.output[0] = only.slice(start)
    entry.outputBytes = Buffer.byteLength(entry.output[0], "utf8")
  }
}

export class TerminalHost {
  private readonly entries = new Map<string, TerminalEntry>()
  private seqCounter = 0
  private readonly titleCounts = new Map<string, number>()
  private emit: EmitFn = () => {}

  setEmit(emit: EmitFn): void {
    this.emit = emit
  }

  create(cwdUri: string, launch: TerminalLaunch | null | undefined, clientId: string): TerminalCreateResult {
    let cwd = cwdUri.length <= 32_768 ? uriToPath(cwdUri) : os.homedir()
    try {
      if (!fs.statSync(cwd).isDirectory()) cwd = os.homedir()
    } catch {
      cwd = os.homedir()
    }

    const custom = launch?.command
      ? { command: launch.command, args: launch.args ?? [] }
      : null

    const candidates: { command: string; args: string[] }[] = custom
      ? [{ command: custom.command, args: custom.args }]
      : [defaultShell(), ...shellFallbacks().map(command => ({ command, args: [] as string[] }))]

    let proc: pty.IPty | null = null
    let lastError: unknown
    for (const candidate of candidates) {
      try {
        proc = pty.spawn(candidate.command, candidate.args, {
          name: "xterm-256color",
          cols: 80,
          rows: 24,
          cwd,
          env: {
            ...process.env,
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
            HOME: process.env.HOME ?? os.homedir(),
          } as Record<string, string>,
        })
        break
      } catch (error) {
        lastError = error
      }
    }
    if (!proc) throw new Error(`failed to spawn terminal: ${String(lastError)}`)

    const id = `term-${Date.now()}-${++this.seqCounter}`
    let title: string | null = null
    if (!custom) {
      const base = path.basename(proc.process || defaultShell().command)
      const key = `${cwd}\0${base}`
      const n = (this.titleCounts.get(key) ?? 0) + 1
      this.titleCounts.set(key, n)
      title = n === 1 ? base : `${base} ${n}`
    }

    const entry: TerminalEntry = {
      id,
      title,
      clientId,
      status: "running",
      exitCode: null,
      signal: null,
      sequence: 0,
      output: [],
      outputBytes: 0,
      proc,
    }
    this.entries.set(id, entry)

    proc.onData(data => {
      entry.sequence += 1
      entry.output.push(data)
      entry.outputBytes += Buffer.byteLength(data, "utf8")
      trimReplay(entry)
      this.emit("terminal:data", [id, data, entry.sequence])
    })

    proc.onExit(({ exitCode, signal }) => {
      entry.status = "exited"
      entry.exitCode = exitCode
      entry.signal = signal != null ? String(signal) : null
      entry.proc = null
      const args: unknown[] = [id, exitCode]
      if (entry.signal) args.push(entry.signal)
      this.emit("terminal:exit", args)
    })

    return { id, title }
  }

  write(id: string, data: string): null {
    if (id.length > 256 || data.length > MAX_WRITE_BYTES) return null
    const entry = this.entries.get(id)
    entry?.proc?.write(data)
    return null
  }

  resize(id: string, cols?: number, rows?: number): null {
    if (id.length > 256) return null
    const requestedCols = cols ?? 80
    const requestedRows = rows ?? 24
    if (requestedCols === 0 || requestedRows === 0) return null
    const c = Math.min(Math.max(requestedCols, 1), 1000)
    const r = Math.min(Math.max(requestedRows, 1), 1000)
    this.entries.get(id)?.proc?.resize(c, r)
    return null
  }

  attach(id: string, clientId: string): TerminalAttachSnapshot | null {
    const entry = this.entries.get(id)
    if (!entry) return null
    entry.clientId = clientId
    return {
      id: entry.id,
      title: entry.title,
      output: entry.output.join(""),
      lastSequence: entry.sequence,
      status: entry.status,
      exitCode: entry.exitCode,
      signal: entry.signal,
    }
  }

  dispose(id: string): null {
    const entry = this.entries.get(id)
    if (!entry) return null
    this.entries.delete(id)
    try {
      entry.proc?.kill()
    } catch {
      /* ignore */
    }
    return null
  }

  stopAll(): void {
    for (const id of [...this.entries.keys()]) this.dispose(id)
  }
}
