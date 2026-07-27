import type {
  AgentProvider,
  IngestNotificationRequest,
  NotificationType,
} from "@gharargah/shared"

/**
 * Parse provider/system notify OSC sequences from a PTY chunk.
 *
 * Supported:
 * - OSC 9 ; message ST/BEL  (iTerm2 notify)
 * - OSC 777 ; notify ; title ; body ST/BEL
 * - OSC 1337 ; Gharargah=notify;<json> ST/BEL
 * - OSC 1337 ; GharargahNotify=<type>|<title>|<message> ST/BEL
 */
export type ParsedOscNotification = Omit<
  IngestNotificationRequest,
  "source"
> & { source: "osc" }

const OSC_RE =
  /\x1b\](?:9;([^\x07\x1b]*)|777;notify;([^\x07\x1b]*);([^\x07\x1b]*)|1337;(Gharargah(?:=notify)?;[^\x07\x1b]*))(?:\x07|\x1b\\)/g

function parseGharargahPayload(payload: string): ParsedOscNotification | null {
  // Gharargah=notify;{json} or GharargahNotify=type|title|message
  if (payload.startsWith("Gharargah=notify;")) {
    const json = payload.slice("Gharargah=notify;".length)
    try {
      const data = JSON.parse(json) as Record<string, unknown>
      const type = (data.type as NotificationType | undefined) ?? "provider-notification"
      const title =
        typeof data.title === "string" && data.title.trim()
          ? data.title
          : "Provider notification"
      return {
        source: "osc",
        type,
        title,
        message: typeof data.message === "string" ? data.message : null,
        sessionId: typeof data.sessionId === "string" ? data.sessionId : null,
        projectId: typeof data.projectId === "string" ? data.projectId : null,
        provider: (data.provider as AgentProvider | undefined) ?? null,
        eventId: typeof data.eventId === "string" ? data.eventId : null,
        providerTurnId:
          typeof data.providerTurnId === "string" ? data.providerTurnId : null,
        providerSessionId:
          typeof data.providerSessionId === "string" ? data.providerSessionId : null,
        providerEvent:
          typeof data.providerEvent === "string" ? data.providerEvent : null,
        requiresAction:
          typeof data.requiresAction === "boolean" ? data.requiresAction : undefined,
        resolveOf:
          data.resolveOf && typeof data.resolveOf === "object"
            ? (data.resolveOf as IngestNotificationRequest["resolveOf"])
            : undefined,
        metadata: data.metadata && typeof data.metadata === "object"
          ? (data.metadata as Record<string, unknown>)
          : { osc: true },
      }
    } catch {
      return null
    }
  }
  if (payload.startsWith("GharargahNotify=")) {
    const rest = payload.slice("GharargahNotify=".length)
    const [typeRaw, titleRaw, ...messageParts] = rest.split("|")
    const type = (typeRaw as NotificationType) || "provider-notification"
    const title = titleRaw?.trim() || "Provider notification"
    const message = messageParts.join("|").trim() || null
    return {
      source: "osc",
      type,
      title,
      message,
      metadata: { osc: true },
    }
  }
  return null
}

export function parseOscNotifications(chunk: string): ParsedOscNotification[] {
  const out: ParsedOscNotification[] = []
  OSC_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = OSC_RE.exec(chunk)) !== null) {
    if (match[1] != null) {
      const message = match[1].trim()
      if (!message) continue
      out.push({
        source: "osc",
        type: "provider-notification",
        title: message.slice(0, 120),
        message: message.length > 120 ? message : null,
        metadata: { osc: 9 },
      })
      continue
    }
    if (match[2] != null) {
      const title = match[2].trim() || "Notification"
      const body = match[3]?.trim() || null
      out.push({
        source: "osc",
        type: "provider-notification",
        title,
        message: body,
        metadata: { osc: 777 },
      })
      continue
    }
    if (match[4]) {
      const parsed = parseGharargahPayload(match[4])
      if (parsed) out.push(parsed)
    }
  }
  return out
}

/** Map common hook event names → notification types. */
export function normalizeHookEventName(
  event: string | null | undefined,
): NotificationType | null {
  if (!event) return null
  const e = event.toLowerCase().replace(/[_\s]+/g, "-")
  if (
    e.includes("turn-complete") ||
    e.includes("stop") ||
    e === "agent-turn-complete" ||
    e === "completed"
  ) {
    return "turn-completed"
  }
  if (e.includes("permission") || e.includes("approval")) {
    return "permission-required"
  }
  if (e.includes("input") || e.includes("ask-user") || e.includes("question")) {
    return "input-required"
  }
  if (e.includes("fail") || e.includes("error")) {
    return "failed"
  }
  if (e.includes("exit")) return "process-exited"
  if (e.includes("start")) return "session-started"
  return "provider-notification"
}
