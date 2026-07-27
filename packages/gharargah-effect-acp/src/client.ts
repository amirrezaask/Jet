/**
 * Minimal ACP JSON-RPC client over stdio.
 * Inspired by t3 effect-acp / our Rust ConnectionPool — Gharargah-owned implementation.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { EventEmitter } from "node:events"

export type AcpJsonRpcId = number | string

export type AcpNotificationHandler = (method: string, params: unknown) => void
export type AcpRequestHandler = (
  method: string,
  params: unknown,
) => Promise<unknown> | unknown

export type AcpClientOptions = {
  command: string
  args?: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  onNotification?: AcpNotificationHandler
  onRequest?: AcpRequestHandler
  /** Max redacted protocol-trace entries retained (default 200). */
  traceLimit?: number
}

export type AcpTraceEntry = {
  at: string
  direction: "in" | "out"
  method?: string
  id?: AcpJsonRpcId
  summary: unknown
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
}

const REPLAY_IDLE_GAP_MS = 2_000
const REPLAY_IDLE_TIMEOUT_MS = 90_000

function redactTraceValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]"
  if (value == null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.slice(0, 20).map(v => redactTraceValue(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (/token|secret|authorization|password|api[_-]?key/i.test(k)) {
      out[k] = "[redacted]"
    } else {
      out[k] = redactTraceValue(v, depth + 1)
    }
  }
  return out
}

export class AcpClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private nextId = 1
  private pending = new Map<AcpJsonRpcId, Pending>()
  private closed = false
  private buffer = ""
  private trace: AcpTraceEntry[] = []
  private traceLimit: number
  /** Last ACP session ids seen on this connection (for inspector list). */
  sessionIds = new Set<string>()

  constructor(private readonly opts: AcpClientOptions) {
    super()
    this.traceLimit = opts.traceLimit ?? 200
  }

  getTrace(): AcpTraceEntry[] {
    return [...this.trace]
  }

  private pushTrace(entry: Omit<AcpTraceEntry, "at">): void {
    this.trace.push({ ...entry, at: new Date().toISOString() })
    if (this.trace.length > this.traceLimit) {
      this.trace.splice(0, this.trace.length - this.traceLimit)
    }
  }

  /** Force-kill the provider process (inspector force-stop / cancel grace). */
  forceKill(): void {
    if (!this.child) return
    try {
      this.child.kill("SIGKILL")
    } catch {
      /* ignore */
    }
  }

  async start(): Promise<void> {
    if (this.child) return
    this.child = spawn(this.opts.command, this.opts.args ?? [], {
      cwd: this.opts.cwd,
      env: { ...process.env, ...this.opts.env },
      stdio: ["pipe", "pipe", "pipe"],
    })
    this.child.stdout.setEncoding("utf8")
    this.child.stderr.setEncoding("utf8")
    this.child.stdout.on("data", (chunk: string) => this.onStdout(chunk))
    this.child.stderr.on("data", (chunk: string) => {
      this.emit("stderr", chunk)
    })
    this.child.on("exit", (code, signal) => {
      this.closed = true
      const err = new Error(`ACP process exited code=${code} signal=${signal}`)
      for (const [, p] of this.pending) p.reject(err)
      this.pending.clear()
      this.emit("exit", code, signal)
    })
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    if (!this.child?.stdin.writable) throw new Error("ACP client not started")
    const id = this.nextId++
    this.pushTrace({
      direction: "out",
      method,
      id,
      summary: redactTraceValue(params ?? {}),
    })
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} }) + "\n"
    return await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child!.stdin.write(payload, err => {
        if (err) {
          this.pending.delete(id)
          reject(err)
        }
      })
    })
  }

  notify(method: string, params?: unknown): void {
    if (!this.child?.stdin.writable) return
    this.pushTrace({
      direction: "out",
      method,
      summary: redactTraceValue(params ?? {}),
    })
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params: params ?? {} }) + "\n"
    this.child.stdin.write(payload)
  }

  async initialize(clientCapabilities?: Record<string, unknown>): Promise<unknown> {
    return this.request("initialize", {
      protocolVersion: 1,
      clientInfo: {
        name: "gharargah",
        title: "Gharargah",
        version: "0.0.1",
      },
      clientCapabilities: clientCapabilities ?? {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
    })
  }

  async createSession(
    cwd: string,
    mcpServers: unknown[] = [],
  ): Promise<{
    sessionId: string
    modes?: {
      currentModeId: string
      availableModes: Array<{ id: string; name: string; description?: string | null }>
    } | null
    configOptions?: Array<{
      id: string
      name: string
      description?: string
      category?: string
      currentValue?: string
      values?: Array<{ value: string; name: string }>
    }> | null
    models?: {
      availableModels: Array<{ modelId?: string; id?: string; name?: string }>
      currentModelId?: string
    } | null
  }> {
    const result = (await this.request("session/new", { cwd, mcpServers })) as {
      sessionId: string
      modes?: {
        currentModeId: string
        availableModes: Array<{ id: string; name: string; description?: string | null }>
      } | null
      configOptions?: Array<{
        id: string
        name: string
        description?: string
        category?: string
        currentValue?: string
        values?: Array<{ value: string; name: string }>
      }> | null
      models?: {
        availableModels: Array<{ modelId?: string; id?: string; name?: string }>
        currentModelId?: string
      } | null
    }
    if (result?.sessionId) this.sessionIds.add(result.sessionId)
    return result
  }

  async authenticate(methodId: string): Promise<unknown> {
    return this.request("authenticate", { methodId })
  }

  async setSessionMode(sessionId: string, modeId: string): Promise<unknown> {
    return this.request("session/set_mode", { sessionId, modeId })
  }

  async setSessionModel(sessionId: string, modelId: string): Promise<unknown> {
    return this.request("session/set_model", { sessionId, modelId })
  }

  /**
   * Prefer when local history exists — no replay (t3code parity).
   * Falls back to caller on method-not-found.
   */
  async resumeSession(
    sessionId: string,
    cwd: string,
    mcpServers: unknown[] = [],
  ): Promise<unknown> {
    this.sessionIds.add(sessionId)
    return this.request("session/resume", { sessionId, cwd, mcpServers })
  }

  async loadSession(
    sessionId: string,
    cwd: string,
    mcpServers: unknown[] = [],
  ): Promise<unknown> {
    this.sessionIds.add(sessionId)
    const started = Date.now()
    let lastUpdate = Date.now()
    const onUpdate = () => {
      lastUpdate = Date.now()
    }
    this.on("sessionUpdate", onUpdate)
    try {
      const resultPromise = this.request("session/load", { sessionId, cwd, mcpServers })
      // Replay idle gate (t3-inspired): wait until updates quiet or timeout.
      await Promise.race([
        resultPromise,
        (async () => {
          while (Date.now() - started < REPLAY_IDLE_TIMEOUT_MS) {
            await new Promise(r => setTimeout(r, 100))
            if (Date.now() - lastUpdate >= REPLAY_IDLE_GAP_MS && Date.now() - started > 200) {
              break
            }
          }
        })(),
      ])
      return await resultPromise
    } finally {
      this.off("sessionUpdate", onUpdate)
    }
  }

  async prompt(sessionId: string, prompt: unknown[]): Promise<unknown> {
    return this.request("session/prompt", { sessionId, prompt })
  }

  /** ACP `session/cancel` is a notification — agents do not reply (t3 effect-acp parity). */
  async cancel(sessionId: string): Promise<unknown> {
    this.notify("session/cancel", { sessionId })
    return undefined
  }

  async setConfigOption(sessionId: string, configId: string, value: string): Promise<unknown> {
    return this.request("session/set_config_option", { sessionId, configId, value })
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    for (const [, p] of this.pending) p.reject(new Error("ACP client closed"))
    this.pending.clear()
    if (this.child) {
      this.child.kill("SIGTERM")
      const force = setTimeout(() => this.child?.kill("SIGKILL"), 2_000)
      await new Promise<void>(resolve => {
        this.child?.once("exit", () => {
          clearTimeout(force)
          resolve()
        })
        setTimeout(resolve, 2_500)
      })
      this.child = null
    }
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk
    let idx: number
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      if (!line) continue
      try {
        this.handleMessage(JSON.parse(line) as Record<string, unknown>)
      } catch (err) {
        this.emit("parseError", err, line)
      }
    }
  }

  private handleMessage(msg: Record<string, unknown>): void {
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const pending = this.pending.get(msg.id as AcpJsonRpcId)
      if (!pending) return
      this.pending.delete(msg.id as AcpJsonRpcId)
      this.pushTrace({
        direction: "in",
        id: msg.id as AcpJsonRpcId,
        summary: redactTraceValue(msg.error ?? msg.result),
      })
      if (msg.error) {
        const errObj = msg.error as { message?: string; code?: number; data?: unknown }
        const err = new Error(
          typeof errObj === "object" && errObj?.message
            ? errObj.message
            : JSON.stringify(msg.error),
        )
        ;(err as Error & { code?: number; data?: unknown }).code = errObj?.code
        ;(err as Error & { code?: number; data?: unknown }).data = errObj?.data
        pending.reject(err)
      } else {
        pending.resolve(msg.result)
      }
      return
    }

    const method = typeof msg.method === "string" ? msg.method : null
    if (!method) return

    this.pushTrace({
      direction: "in",
      method,
      id: msg.id as AcpJsonRpcId | undefined,
      summary: redactTraceValue(msg.params),
    })

    if (msg.id !== undefined) {
      // Server → client request
      void Promise.resolve(this.opts.onRequest?.(method, msg.params))
        .then(result => {
          this.respond(msg.id as AcpJsonRpcId, result ?? null)
        })
        .catch(err => {
          this.respondError(msg.id as AcpJsonRpcId, String(err))
        })
      return
    }

    if (method === "session/update") {
      this.emit("sessionUpdate", msg.params)
    }
    this.opts.onNotification?.(method, msg.params)
    this.emit("notification", method, msg.params)
  }

  private respond(id: AcpJsonRpcId, result: unknown): void {
    if (!this.child?.stdin.writable) return
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n")
  }

  private respondError(id: AcpJsonRpcId, message: string): void {
    if (!this.child?.stdin.writable) return
    this.child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message },
      }) + "\n",
    )
  }
}

/** Idle reaper defaults matching t3 / our Rust supervisor. */
export const ACP_IDLE_REAP_MS = 30 * 60 * 1000
export const ACP_REAPER_INTERVAL_MS = 5 * 60 * 1000
export const ACP_CANCEL_FORCE_KILL_MS = 15_000
