import type { AgentEvent, AgentSessionDocument, TranscriptItem } from "./types.js"

export function applyAgentEvent(
  doc: AgentSessionDocument,
  event: AgentEvent,
): AgentSessionDocument {
  switch (event.type) {
    case "session/ready":
      return { ...doc, status: "ready", stubMode: doc.stubMode }
    case "session/closed":
      return { ...doc, status: "closed", pendingApproval: null }
    case "session/error":
      return {
        ...doc,
        status: "error",
        transcript: [
          ...doc.transcript,
          markerItem(`error-${event.sessionId}-${Date.now()}`, "error", event.message),
        ],
      }
    case "turn/started":
      return { ...doc, status: "streaming" }
    case "turn/completed":
      return { ...doc, status: "ready", pendingApproval: null }
    case "message/delta": {
      const existingIdx = doc.transcript.findIndex(
        i => i.kind === "message" && i.id === event.messageId,
      )
      if (existingIdx >= 0) {
        const existing = doc.transcript[existingIdx] as Extract<TranscriptItem, { kind: "message" }>
        const next = [...doc.transcript]
        next[existingIdx] = {
          ...existing,
          text: existing.text + event.delta,
          streaming: true,
        }
        return { ...doc, status: "streaming", transcript: next }
      }
      return {
        ...doc,
        status: "streaming",
        transcript: [
          ...doc.transcript,
          {
            kind: "message",
            id: event.messageId,
            role: event.role,
            text: event.delta,
            streaming: true,
            createdAt: Date.now(),
          },
        ],
      }
    }
    case "message/done": {
      const next = doc.transcript.map(item => {
        if (item.kind === "message" && item.id === event.messageId) {
          return { ...item, streaming: false }
        }
        return item
      })
      return { ...doc, status: "ready", transcript: next }
    }
    case "marker":
      return {
        ...doc,
        transcript: [
          ...doc.transcript,
          { kind: "marker", ...event.marker },
        ],
      }
    case "approval/request":
      return {
        ...doc,
        pendingApproval: { requestId: event.requestId, summary: event.summary },
        transcript: [
          ...doc.transcript,
          markerItem(
            `approval-${event.requestId}`,
            "approval",
            event.summary,
            undefined,
            event.requestId,
          ),
        ],
      }
    default:
      return doc
  }
}

function markerItem(
  id: string,
  variant: Extract<TranscriptItem, { kind: "marker" }>["variant"],
  text: string,
  toolName?: string,
  requestId?: string,
): TranscriptItem {
  return {
    kind: "marker",
    id,
    variant,
    text,
    toolName,
    requestId,
    createdAt: Date.now(),
  }
}

export function stubWelcomeTranscript(provider: string, stubMode: boolean): TranscriptItem[] {
  const items: TranscriptItem[] = [
    {
      kind: "marker",
      id: "welcome",
      variant: "separator",
      text: `${provider} session`,
      createdAt: Date.now(),
    },
  ]
  if (stubMode) {
    items.push({
      kind: "marker",
      id: "stub-notice",
      variant: "status",
      text: "Agent CLI requires Jet desktop. Composer is disabled in browser mode.",
      createdAt: Date.now(),
    })
  }
  return items
}
