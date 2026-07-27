/**
 * Normalize assistant/user text that may arrive as a string or provider
 * content-block array (`[{ type: "text", text: "…" }]`).
 */
export function coerceAssistantText(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) {
    return value.map(coerceAssistantText).filter(Boolean).join("")
  }
  if (typeof value === "object") {
    const record = value as { text?: unknown; content?: unknown; delta?: unknown }
    if (record.text != null) return coerceAssistantText(record.text)
    if (record.delta != null) return coerceAssistantText(record.delta)
    if (record.content != null) return coerceAssistantText(record.content)
  }
  return ""
}
