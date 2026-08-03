import * as pty from "node-pty"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { uriToPath } from "./paths.js"

const MAX_TERMINAL_REPLAY = 2 * 1024 * 1024
const MAX_WRITE_BYTES = 1024 * 1024
/** Hard cap concurrent PTY entries (running + exited-but-not-disposed). */
const MAX_TERMINAL_ENTRIES = 64
/** Auto-dispose exited PTYs so replay buffers do not linger forever. */
const EXITED_TERMINAL_DISPOSE_TTL_MS = 90_000
/**
 * node-pty commonly delivers output in 1 KiB chunks. Sending each chunk as a
 * JSON/WebSocket event makes a log flood spend more time on framing, parsing,
 * and callbacks than on terminal emulation. Keep interactive latency below a
 * frame while coalescing throughput-oriented bursts into useful-sized frames.
 */
const TERMINAL_EMIT_BATCH_BYTES = 64 * 1024
const TERMINAL_EMIT_BATCH_DELAY_MS = 4
/**
 * Keystroke-sized PTY chunks flush immediately after idle (VS Code emits per
 * onData). Larger chunks keep the 4ms / 64KiB coalesce for flood framing —
 * threshold stays well below typical node-pty ~1KiB reads.
 */
const TERMINAL_EMIT_INTERACTIVE_BYTES = 32

/**
 * VS Code FlowControlConstants — pause the PTY when the renderer falls behind
 * instead of flooding WS / shedding frames (which is what made agent TUIs choke).
 * @see https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/common/terminal.ts
 */
export const TERMINAL_FLOW_HIGH_WATERMARK_CHARS = 100_000
export const TERMINAL_FLOW_LOW_WATERMARK_CHARS = 5_000
/** Client should ack at least this often so the host can resume. */
export const TERMINAL_FLOW_ACK_CHARS = 5_000

export type TerminalLaunch = {
  command?: string
  args?: string[]
  cols?: number
  rows?: number
  /** Extra env vars merged into the PTY environment (ADE hook forwarders). */
  env?: Record<string, string>
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
  titleKey: string | null
  clientId: string
  status: "running" | "exited"
  exitCode: number | null
  signal: number | null
  sequence: number
  output: string[]
  outputHead: number
  outputBytes: number
  pendingOutput: string[]
  pendingOutputBytes: number
  pendingOutputTimer: ReturnType<typeof setTimeout> | null
  disposeTimer: ReturnType<typeof setTimeout> | null
  /** Chars emitted to the client that have not yet been ack'd as parsed. */
  unacknowledgedChars: number
  ptyPaused: boolean
  proc: pty.IPty | null
  disposed: boolean
  dataDisposable: pty.IDisposable | null
  exitDisposable: pty.IDisposable | null
}

function pausePtyForFlowControl(entry: TerminalEntry): void {
  if (entry.ptyPaused || !entry.proc) return
  try {
    entry.proc.pause()
    entry.ptyPaused = true
  } catch {
    /* ignore — some platforms/adapters may not support pause */
  }
}

function resumePtyForFlowControl(entry: TerminalEntry): void {
  if (!entry.ptyPaused || !entry.proc) return
  try {
    entry.proc.resume()
    entry.ptyPaused = false
  } catch {
    /* ignore */
  }
}

function flushPendingOutput(entry: TerminalEntry, emit: EmitFn): void {
  if (entry.pendingOutputTimer) {
    clearTimeout(entry.pendingOutputTimer)
    entry.pendingOutputTimer = null
  }
  if (entry.disposed || entry.pendingOutput.length === 0) return
  const data =
    entry.pendingOutput.length === 1
      ? entry.pendingOutput[0]!
      : entry.pendingOutput.join("")
  entry.pendingOutput.length = 0
  entry.pendingOutputBytes = 0
  // Flow control counts chars (VS Code) — JS string length matches xterm write units.
  entry.unacknowledgedChars += data.length
  emit("terminal:data", [entry.id, data, entry.sequence])
  if (
    !entry.ptyPaused &&
    entry.unacknowledgedChars > TERMINAL_FLOW_HIGH_WATERMARK_CHARS
  ) {
    pausePtyForFlowControl(entry)
  }
}

function queueOutput(
  entry: TerminalEntry,
  data: string,
  dataBytes: number,
  emit: EmitFn,
): void {
  // Keep normal batches bounded. A single unusually large node-pty chunk is
  // forwarded intact so Unicode/control sequences are never split here.
  if (
    entry.pendingOutputBytes > 0 &&
    entry.pendingOutputBytes + dataBytes > TERMINAL_EMIT_BATCH_BYTES
  ) {
    flushPendingOutput(entry, emit)
  }
  entry.pendingOutput.push(data)
  entry.pendingOutputBytes += dataBytes
  if (entry.pendingOutputBytes >= TERMINAL_EMIT_BATCH_BYTES) {
    flushPendingOutput(entry, emit)
    return
  }
  // Interactive echo: first small chunk after idle must not wait 4ms.
  if (
    entry.pendingOutputBytes <= TERMINAL_EMIT_INTERACTIVE_BYTES &&
    entry.pendingOutput.length === 1 &&
    !entry.pendingOutputTimer
  ) {
    flushPendingOutput(entry, emit)
    return
  }
  if (!entry.pendingOutputTimer) {
    entry.pendingOutputTimer = setTimeout(
      () => flushPendingOutput(entry, emit),
      TERMINAL_EMIT_BATCH_DELAY_MS,
    )
  }
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
    if (this.entries.size >= MAX_TERMINAL_ENTRIES) {
      throw new Error(
        `too many terminals (max ${MAX_TERMINAL_ENTRIES}); dispose unused sessions first`,
      )
    }

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
            ...(launch?.env ?? {}),
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
    let titleKey: string | null = null
    if (!custom) {
      const base = path.basename(proc.process || defaultShell().command)
      titleKey = `${cwd}\0${base}`
      const n = (this.titleCounts.get(titleKey) ?? 0) + 1
      this.titleCounts.set(titleKey, n)
      title = n === 1 ? base : `${base} ${n}`
    }

    const entry: TerminalEntry = {
      id,
      title,
      titleKey,
      clientId,
      status: "running",
      exitCode: null,
      signal: null,
      sequence: 0,
      output: [],
      outputHead: 0,
      outputBytes: 0,
      pendingOutput: [],
      pendingOutputBytes: 0,
      pendingOutputTimer: null,
      disposeTimer: null,
      unacknowledgedChars: 0,
      ptyPaused: false,
      proc,
      disposed: false,
      dataDisposable: null,
      exitDisposable: null,
    }
    this.entries.set(id, entry)

    entry.dataDisposable = proc.onData(data => {
      if (entry.disposed) return
      entry.sequence += 1
      const dataBytes = Buffer.byteLength(data, "utf8")
      entry.output.push(data)
      entry.outputBytes += dataBytes
      trimReplay(entry)
      queueOutput(entry, data, dataBytes, this.emit)
    })

    entry.exitDisposable = proc.onExit(({ exitCode, signal }) => {
      if (entry.disposed) return
      // Preserve wire ordering: consumers must see the final output before exit.
      flushPendingOutput(entry, this.emit)
      entry.status = "exited"
      entry.exitCode = exitCode
      entry.signal = signal ?? null
      entry.proc = null
      const args: unknown[] = [id, exitCode]
      if (entry.signal) args.push(entry.signal)
      this.emit("terminal:exit", args)
      this.scheduleDisposeAfterExit(entry)
    })

    return { id, title }
  }

  private scheduleDisposeAfterExit(entry: TerminalEntry): void {
    if (entry.disposeTimer || entry.disposed) return
    entry.disposeTimer = setTimeout(() => {
      entry.disposeTimer = null
      if (entry.disposed) return
      this.dispose(entry.id)
    }, EXITED_TERMINAL_DISPOSE_TTL_MS)
    // Do not keep the process alive solely for this timer.
    entry.disposeTimer.unref?.()
  }

  private clearDisposeTimer(entry: TerminalEntry): void {
    if (!entry.disposeTimer) return
    clearTimeout(entry.disposeTimer)
    entry.disposeTimer = null
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

  /**
   * Renderer finished parsing `charCount` chars of previously emitted output.
   * Drop below the low watermark → resume a paused PTY (VS Code pattern).
   */
  acknowledgeData(id: string, charCount: number): null {
    if (id.length > 256) return null
    const entry = this.entries.get(id)
    if (!entry || entry.disposed) return null
    const n = Number.isFinite(charCount) ? Math.max(0, Math.trunc(charCount)) : 0
    entry.unacknowledgedChars = Math.max(0, entry.unacknowledgedChars - n)
    if (
      entry.ptyPaused &&
      entry.unacknowledgedChars < TERMINAL_FLOW_LOW_WATERMARK_CHARS
    ) {
      resumePtyForFlowControl(entry)
    }
    return null
  }

  /** Force-resume after attach/reconnect so a stale pause cannot stick forever. */
  clearUnacknowledgedChars(id: string): null {
    const entry = this.entries.get(id)
    if (!entry) return null
    entry.unacknowledgedChars = 0
    resumePtyForFlowControl(entry)
    return null
  }

  attach(id: string, clientId: string): TerminalAttachSnapshot | null {
    const entry = this.entries.get(id)
    if (!entry) return null
    // Client re-attached — cancel auto-dispose so replay stays available.
    this.clearDisposeTimer(entry)
    // Establish a clean sequence boundary. Otherwise a batch containing both
    // pre- and post-attach bytes could be accepted in full and duplicate replay.
    flushPendingOutput(entry, this.emit)
    entry.clientId = clientId
    // Replay is applied synchronously on the client — reset flow control so a
    // previous session's unacked count cannot keep the PTY paused.
    entry.unacknowledgedChars = 0
    resumePtyForFlowControl(entry)
    // If already exited, reschedule dispose after this attach window.
    if (entry.status === "exited") {
      this.scheduleDisposeAfterExit(entry)
    }
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
    this.clearDisposeTimer(entry)
    if (entry.pendingOutputTimer) clearTimeout(entry.pendingOutputTimer)
    entry.pendingOutputTimer = null
    entry.pendingOutput.length = 0
    entry.pendingOutputBytes = 0
    entry.unacknowledgedChars = 0
    resumePtyForFlowControl(entry)
    entry.dataDisposable?.dispose()
    entry.exitDisposable?.dispose()
    entry.dataDisposable = null
    entry.exitDisposable = null
    if (entry.titleKey) {
      const n = (this.titleCounts.get(entry.titleKey) ?? 1) - 1
      if (n <= 0) this.titleCounts.delete(entry.titleKey)
      else this.titleCounts.set(entry.titleKey, n)
    }
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
