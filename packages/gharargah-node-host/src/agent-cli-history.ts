import { spawn } from "node:child_process"
import type {
  AgentCliHistoryProvider,
  AgentCliHistoryResult,
  AgentCliHistorySession,
} from "@gharargah/shared"

const HISTORY_TIMEOUT_MS = 8_000
const MAX_HISTORY_OUTPUT_BYTES = 2 * 1024 * 1024

type CommandOutput = {
  stdout: string
  stderr: string
}

export type AgentCliHistoryAdapters = {
  runCommand: (
    command: string,
    args: string[],
    cwd: string,
    signal?: AbortSignal,
  ) => Promise<CommandOutput>
  listCodex: (
    cwd: string,
    limit: number,
    signal?: AbortSignal,
  ) => Promise<AgentCliHistorySession[]>
}

class AgentCliUnavailableError extends Error {
  readonly command: string

  constructor(command: string) {
    super(`${command} is not installed or is not available on PATH`)
    this.name = "AgentCliUnavailableError"
    this.command = command
  }
}

function cancellationError(): Error {
  const error = new Error("Agent CLI history request cancelled")
  error.name = "AbortError"
  return error
}

function appendBounded(current: string, chunk: string): string {
  const next = `${current}${chunk}`
  if (Buffer.byteLength(next, "utf8") <= MAX_HISTORY_OUTPUT_BYTES) return next
  throw new Error("Agent CLI history output exceeded 2 MiB")
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<CommandOutput> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancellationError())
      return
    }

    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let settled = false

    const finish = (result?: CommandOutput, error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      if (error) reject(error)
      else if (result) resolve(result)
    }
    const stopWith = (error: Error) => {
      child.kill("SIGTERM")
      finish(undefined, error)
    }
    const onAbort = () => stopWith(cancellationError())
    const timer = setTimeout(
      () => stopWith(new Error(`${command} session history timed out`)),
      HISTORY_TIMEOUT_MS,
    )

    signal?.addEventListener("abort", onAbort, { once: true })
    child.stdout.on("data", chunk => {
      try {
        stdout = appendBounded(stdout, String(chunk))
      } catch (error) {
        stopWith(error instanceof Error ? error : new Error(String(error)))
      }
    })
    child.stderr.on("data", chunk => {
      try {
        stderr = appendBounded(stderr, String(chunk))
      } catch (error) {
        stopWith(error instanceof Error ? error : new Error(String(error)))
      }
    })
    child.on("error", error => {
      if (error.message.includes("ENOENT")) {
        finish(undefined, new AgentCliUnavailableError(command))
        return
      }
      finish(undefined, error)
    })
    child.on("close", code => {
      if (settled) return
      if (code !== 0) {
        finish(
          undefined,
          new Error(
            `${command} could not list sessions${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
          ),
        )
        return
      }
      finish({ stdout, stderr })
    })
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function cleanTitle(value: string | null, fallback: string): string {
  const firstLine = value?.split(/\r?\n/, 1)[0]?.replace(/\s+/g, " ").trim()
  return (firstLine || fallback).slice(0, 160)
}

function epochIso(value: number | null, unit: "seconds" | "milliseconds"): string | null {
  if (value === null || value < 0) return null
  const date = new Date(unit === "seconds" ? value * 1_000 : value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function parseOpenCodeSessionList(output: string): AgentCliHistorySession[] {
  let raw: unknown
  try {
    raw = JSON.parse(output)
  } catch {
    throw new Error("OpenCode returned invalid session history JSON")
  }
  if (!Array.isArray(raw)) {
    throw new Error("OpenCode returned an unexpected session history payload")
  }

  const sessions: AgentCliHistorySession[] = []
  for (const value of raw) {
    if (!isRecord(value)) continue
    const id = stringField(value, "id")
    if (!id) continue
    sessions.push({
      id,
      provider: "opencode",
      title: cleanTitle(stringField(value, "title"), "OpenCode session"),
      cwd: stringField(value, "directory"),
      createdAt: epochIso(numberField(value, "created"), "milliseconds"),
      updatedAt: epochIso(numberField(value, "updated"), "milliseconds"),
    })
  }
  return sessions
}

const GROK_SESSION_ROW =
  /^(\S+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})\s+\S+\s+(.+)$/

export function parseGrokSessionList(
  output: string,
  cwd: string,
): AgentCliHistorySession[] {
  const sessions: AgentCliHistorySession[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(GROK_SESSION_ROW)
    if (!match) continue
    const [, id, created, updated, summary] = match
    if (!id || !created || !updated || !summary || id === "SESSION") continue
    sessions.push({
      id,
      provider: "grok",
      title: cleanTitle(summary === "(no summary)" ? null : summary, "Grok session"),
      cwd,
      createdAt: new Date(`${created}T00:00:00.000Z`).toISOString(),
      updatedAt: new Date(`${updated}T00:00:00.000Z`).toISOString(),
    })
  }
  return sessions
}

export function parseCodexThreadListResponse(
  line: string,
): AgentCliHistorySession[] | null {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return null
  }
  if (!isRecord(raw) || raw.id !== 2) return null
  if (isRecord(raw.error)) {
    throw new Error(
      stringField(raw.error, "message") ?? "Codex could not list previous sessions",
    )
  }
  if (!isRecord(raw.result) || !Array.isArray(raw.result.data)) {
    throw new Error("Codex returned an unexpected thread/list response")
  }

  const sessions: AgentCliHistorySession[] = []
  for (const value of raw.result.data) {
    if (!isRecord(value)) continue
    const id = stringField(value, "id")
    if (!id) continue
    const name = stringField(value, "name")
    const preview = stringField(value, "preview")
    sessions.push({
      id,
      provider: "codex",
      title: cleanTitle(name ?? preview, "Codex session"),
      cwd: stringField(value, "cwd"),
      createdAt: epochIso(numberField(value, "createdAt"), "seconds"),
      updatedAt: epochIso(numberField(value, "updatedAt"), "seconds"),
    })
  }
  return sessions
}

type CodexHistoryHandshakeEvent = {
  readonly outbound: string[]
  readonly sessions?: AgentCliHistorySession[]
  readonly error?: Error
}

export function createCodexHistoryHandshake(limit: number): {
  readonly start: () => string[]
  readonly receive: (line: string) => CodexHistoryHandshakeEvent
} {
  let state: "idle" | "initialize" | "list" | "settled" = "idle"
  const initialize = JSON.stringify({
    id: 1,
    method: "initialize",
    params: {
      clientInfo: { name: "yaade", title: "YAADE", version: "0.1.0" },
      capabilities: {},
    },
  })
  const initialized = JSON.stringify({ method: "initialized" })
  const list = JSON.stringify({
    id: 2,
    method: "thread/list",
    params: {
      archived: false,
      limit,
      sortKey: "updated_at",
      sortDirection: "desc",
    },
  })

  return {
    start() {
      if (state !== "idle") return []
      state = "initialize"
      return [initialize]
    },
    receive(line) {
      if (state === "initialize") {
        let value: unknown
        try {
          value = JSON.parse(line) as unknown
        } catch {
          return { outbound: [] }
        }
        if (!value || typeof value !== "object") return { outbound: [] }
        const response = value as Record<string, unknown>
        if (response.id !== 1) return { outbound: [] }
        if (response.error != null) {
          state = "settled"
          return {
            outbound: [],
            error: new Error("Codex app-server initialize failed"),
          }
        }
        state = "list"
        return { outbound: [initialized, list] }
      }
      if (state !== "list") return { outbound: [] }
      const sessions = parseCodexThreadListResponse(line)
      if (!sessions) return { outbound: [] }
      state = "settled"
      return { outbound: [], sessions }
    },
  }
}

function listCodexSessions(
  cwd: string,
  limit: number,
  signal?: AbortSignal,
): Promise<AgentCliHistorySession[]> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancellationError())
      return
    }

    const child = spawn("codex", ["app-server", "--stdio"], {
      cwd,
      env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    })
    let pending = ""
    let stderr = ""
    let settled = false
    const handshake = createCodexHistoryHandshake(limit)

    const finish = (sessions?: AgentCliHistorySession[], error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      child.kill("SIGTERM")
      if (error) reject(error)
      else resolve(sessions ?? [])
    }
    const onAbort = () => finish(undefined, cancellationError())
    const timer = setTimeout(
      () => finish(undefined, new Error("Codex session history timed out")),
      HISTORY_TIMEOUT_MS,
    )

    signal?.addEventListener("abort", onAbort, { once: true })
    child.on("error", error => {
      if (error.message.includes("ENOENT")) {
        finish(undefined, new AgentCliUnavailableError("codex"))
        return
      }
      finish(undefined, error)
    })
    child.stderr.on("data", chunk => {
      try {
        stderr = appendBounded(stderr, String(chunk))
      } catch (error) {
        finish(undefined, error instanceof Error ? error : new Error(String(error)))
      }
    })
    child.stdout.on("data", chunk => {
      try {
        pending = appendBounded(pending, String(chunk))
        const lines = pending.split(/\r?\n/)
        pending = lines.pop() ?? ""
        for (const line of lines) {
          const event = handshake.receive(line)
          if (event.outbound.length > 0) {
            child.stdin.write(`${event.outbound.join("\n")}\n`)
          }
          if (event.error) {
            finish(undefined, event.error)
            return
          }
          if (event.sessions) {
            finish(event.sessions.slice(0, limit))
            return
          }
        }
      } catch (error) {
        finish(undefined, error instanceof Error ? error : new Error(String(error)))
      }
    })
    child.on("close", code => {
      if (settled) return
      finish(
        undefined,
        new Error(
          `Codex app-server exited before thread/list completed (${code ?? "unknown"})${
            stderr.trim() ? `: ${stderr.trim()}` : ""
          }`,
        ),
      )
    })
    child.on("spawn", () => {
      child.stdin.write(`${handshake.start().join("\n")}\n`)
    })
  })
}

const defaultAdapters: AgentCliHistoryAdapters = {
  runCommand,
  listCodex: listCodexSessions,
}

export async function listAgentCliHistory(
  provider: AgentCliHistoryProvider,
  options: { cwd: string; limit?: number; signal?: AbortSignal },
  adapters: AgentCliHistoryAdapters = defaultAdapters,
): Promise<AgentCliHistoryResult> {
  const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 12)))

  if (provider === "claude") {
    return {
      provider,
      state: "unsupported",
      message: "Claude Code currently exposes previous sessions only in its interactive resume picker.",
      sessions: [],
    }
  }
  if (provider === "cursor") {
    return {
      provider,
      state: "unsupported",
      message: "Cursor Agent currently requires a raw terminal for its interactive session list.",
      sessions: [],
    }
  }

  try {
    if (provider === "codex") {
      return {
        provider,
        state: "ready",
        sessions: await adapters.listCodex(options.cwd, limit, options.signal),
      }
    }
    if (provider === "opencode") {
      const output = await adapters.runCommand(
        "opencode",
        ["session", "list", "--format", "json", "--max-count", String(limit)],
        options.cwd,
        options.signal,
      )
      return {
        provider,
        state: "ready",
        sessions: parseOpenCodeSessionList(output.stdout).slice(0, limit),
      }
    }
    const output = await adapters.runCommand(
      "grok",
      ["sessions", "list", "--limit", String(limit)],
      options.cwd,
      options.signal,
    )
    return {
      provider,
      state: "ready",
      sessions: parseGrokSessionList(output.stdout, options.cwd).slice(0, limit),
    }
  } catch (error) {
    if (error instanceof AgentCliUnavailableError) {
      return {
        provider,
        state: "unavailable",
        message: error.message,
        sessions: [],
      }
    }
    throw error
  }
}
