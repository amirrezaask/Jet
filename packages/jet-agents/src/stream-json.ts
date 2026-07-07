import type { TurnEvent } from "./turn-events.js"

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null
}

function extractAssistantText(value: unknown): string | null {
  const record = asRecord(value)
  if (!record) return null

  if (typeof record.text === "string") return record.text
  if (typeof record.result === "string" && record.type === "result") return record.result

  const message = asRecord(record.message)
  if (!message) return null

  const content = message.content
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return null

  const parts: string[] = []
  for (const item of content) {
    const block = asRecord(item)
    if (!block) continue
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text)
    }
  }
  return parts.length > 0 ? parts.join("") : null
}

export function parseStreamJsonLine(
  line: string,
  assistantMessageId: string,
): TurnEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed) as unknown
  } catch {
    return null
  }

  const record = asRecord(parsed)
  if (!record) return null

  const type = record.type
  if (type === "assistant") {
    const text = extractAssistantText(record)
    if (text == null) return null
    return { kind: "text-snapshot", assistantMessageId, text }
  }

  if (type === "result") {
    const isError = record.is_error === true || record.isError === true
    if (isError) {
      const message =
        extractAssistantText(record) ??
        (typeof record.error === "string" ? record.error : null) ??
        "Agent turn failed"
      return { kind: "turn-error", message }
    }
  }

  if (type === "error") {
    const message =
      typeof record.message === "string"
        ? record.message
        : typeof record.error === "string"
          ? record.error
          : "Agent turn failed"
    return { kind: "turn-error", message }
  }

  return null
}

export function splitStreamJsonBuffer(buffer: string): { lines: string[]; rest: string } {
  const lines = buffer.split("\n")
  const rest = lines.pop() ?? ""
  return { lines, rest }
}
