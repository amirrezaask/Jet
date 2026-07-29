import * as pty from "node-pty"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { uriToPath } from "./paths.js"

const MAX_TERMINAL_REPLAY = 2 * 1024 * 1024
const MAX_WRITE_BYTES = 1024 * 1024

export type TerminalLaunch = {
  command?: string
  args?: string[]
  cols?: number
  rows?: number
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
  signal: number | null
}

type EmitFn = (channel: string, args: unknown[]) => void

type TerminalEntry = {
  id: string
  title: string | null
  clientId: string
  status: "running" | "exited"
  exitCode: number | null
  signal: number | null
  sequence: number
  output: string[]
  outputHead: number
  outputBytes: number
  proc: pty.IPty | null
  disposed: boolean
  dataDisposable: pty.IDisposable | null
  exitDisposable: pty.IDisposable | null
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
  while (
    entry.outputBytes > MAX_TERMINAL_REPLAY &&
    entry.output.length - entry.outputHead > 1
  ) {
    const dropped = entry.output[entry.outputHead]!
    entry.output[entry.outputHead] = ""
    entry.outputHead += 1
    entry.outputBytes -= Buffer.byteLength(dropped, "utf8")
  }
  if (
    entry.outputBytes > MAX_TERMINAL_REPLAY &&
    entry.output.length - entry.outputHead === 1
  ) {
    const bytes = Buffer.from(entry.output[entry.outputHead]!, "utf8")
    let start = bytes.length - MAX_TERMINAL_REPLAY
    while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start += 1
    entry.output[entry.outputHead] = bytes.subarray(start).toString("utf8")
    entry.outputBytes = Buffer.byteLength(entry.output[entry.outputHead], "utf8")
  }
  if (entry.outputHead > 1024 && entry.outputHead * 2 > entry.output.length) {
    entry.output = entry.output.slice(entry.outputHead)
    entry.outputHead = 0
  }
}

export function normalizeTerminalSize(
  cols: number | undefined,
  rows: number | undefined,
): { cols: number; rows: number } | null {
  const requestedCols = cols ?? 80
  const requestedRows = rows ?? 24
  if (
    !Number.isFinite(requestedCols) ||
    !Number.isFinite(requestedRows) ||
    requestedCols <= 0 ||
    requestedRows <= 0
  ) {
    return null
  }
  return {
    cols: Math.min(Math.max(Math.trunc(requestedCols), 1), 1000),
    rows: Math.min(Math.max(Math.trunc(requestedRows), 1), 1000),
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
    const initialSize = normalizeTerminalSize(launch?.cols, launch?.rows) ?? {
      cols: 80,
      rows: 24,
    }

    const candidates: { command: string; args: string[] }[] = custom
      ? [{ command: custom.command, args: custom.args }]
      : [defaultShell(), ...shellFallbacks().map(command => ({ command, args: [] as string[] }))]

    let proc: pty.IPty | null = null
    let lastError: unknown
    for (const candidate of candidates) {
      try {
        proc = pty.spawn(candidate.command, candidate.args, {
          name: "xterm-256color",
          cols: initialSize.cols,
          rows: initialSize.rows,
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
      outputHead: 0,
      outputBytes: 0,
      proc,
      disposed: false,
      dataDisposable: null,
      exitDisposable: null,
    }
    this.entries.set(id, entry)

    entry.dataDisposable = proc.onData(data => {
      if (entry.disposed) return
      entry.sequence += 1
      entry.output.push(data)
      entry.outputBytes += Buffer.byteLength(data, "utf8")
      trimReplay(entry)
      this.emit("terminal:data", [id, data, entry.sequence])
    })

    entry.exitDisposable = proc.onExit(({ exitCode, signal }) => {
      if (entry.disposed) return
      entry.status = "exited"
      entry.exitCode = exitCode
      entry.signal = signal ?? null
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

  writeBinary(id: string, dataBase64: string): null {
    if (id.length > 256 || dataBase64.length > MAX_WRITE_BYTES * 2) return null
    const entry = this.entries.get(id)
    if (!entry?.proc) return null
    let data: Buffer
    try {
      data = Buffer.from(dataBase64, "base64")
    } catch {
      return null
    }
    if (data.byteLength > MAX_WRITE_BYTES) return null
    entry.proc.write(data)
    return null
  }

  resize(id: string, cols?: number, rows?: number): null {
    if (id.length > 256) return null
    const size = normalizeTerminalSize(cols, rows)
    if (!size) return null
    this.entries.get(id)?.proc?.resize(size.cols, size.rows)
    return null
  }

  attach(id: string, clientId: string): TerminalAttachSnapshot | null {
    const entry = this.entries.get(id)
    if (!entry) return null
    entry.clientId = clientId
    return {
      id: entry.id,
      title: entry.title,
      output: entry.output.slice(entry.outputHead).join(""),
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
    entry.disposed = true
    entry.dataDisposable?.dispose()
    entry.exitDisposable?.dispose()
    entry.dataDisposable = null
    entry.exitDisposable = null
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
