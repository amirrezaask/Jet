import type { TurnEvent } from "@jet/agents"
import { parseStreamJsonLine, splitStreamJsonBuffer } from "@jet/agents"
import { spawn, type ChildProcess } from "node:child_process"

export type CodexDriverInput = {
  command: string
  args: string[]
  cwd: string
  assistantMessageId: string
  signal: AbortSignal
  onEvent: (event: TurnEvent) => void
}

function parseCodexJsonLine(line: string, assistantMessageId: string): TurnEvent | null {
  const streamEvent = parseStreamJsonLine(line, assistantMessageId)
  if (streamEvent) return streamEvent

  const trimmed = line.trim()
  if (!trimmed) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed) as unknown
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>

  const type = record.type
  if (type === "item.completed" || type === "item.updated") {
    const item = record.item
    if (!item || typeof item !== "object" || Array.isArray(item)) return null
    const itemRecord = item as Record<string, unknown>
    if (itemRecord.type === "agent_message" && typeof itemRecord.text === "string") {
      return { kind: "text-snapshot", assistantMessageId, text: itemRecord.text }
    }
  }

  if (typeof record.message === "string") {
    return { kind: "text-snapshot", assistantMessageId, text: record.message }
  }

  return null
}

export function runCodexJsonCli(input: CodexDriverInput): Promise<void> {
  return new Promise(resolve => {
    let child: ChildProcess | null = null
    let buffer = ""
    let finished = false

    const finish = () => {
      if (finished) return
      finished = true
      resolve()
    }

    const onAbort = () => {
      child?.kill("SIGTERM")
    }

    if (input.signal.aborted) {
      input.onEvent({ kind: "turn-error", message: "Turn interrupted" })
      finish()
      return
    }

    input.signal.addEventListener("abort", onAbort, { once: true })

    child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    })

    child.stdout?.setEncoding("utf8")
    child.stderr?.setEncoding("utf8")

    child.stdout?.on("data", chunk => {
      buffer += String(chunk)
      const { lines, rest } = splitStreamJsonBuffer(buffer)
      buffer = rest
      for (const line of lines) {
        const event = parseCodexJsonLine(line, input.assistantMessageId)
        if (event) input.onEvent(event)
      }
    })

    let stderr = ""
    child.stderr?.on("data", chunk => {
      stderr += String(chunk)
    })

    child.on("error", error => {
      input.onEvent({
        kind: "turn-error",
        message: error instanceof Error ? error.message : String(error),
      })
      finish()
    })

    child.on("close", code => {
      input.signal.removeEventListener("abort", onAbort)
      if (buffer.trim()) {
        const event = parseCodexJsonLine(buffer, input.assistantMessageId)
        if (event) input.onEvent(event)
      }
      if (input.signal.aborted) {
        input.onEvent({ kind: "turn-error", message: "Turn interrupted" })
        finish()
        return
      }
      if (code !== 0) {
        const message = stderr.trim() || `Codex exited with code ${code ?? "unknown"}`
        input.onEvent({ kind: "turn-error", message })
        finish()
        return
      }
      input.onEvent({ kind: "turn-complete" })
      finish()
    })
  })
}
