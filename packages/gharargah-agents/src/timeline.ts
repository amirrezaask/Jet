import type {
  AgentMessage,
  AgentThread,
  TimelineChatMessage,
  TimelineEntry,
  TurnDiffSummary,
} from "./types.js"

export function agentMessageToTimelineChatMessage(message: AgentMessage): TimelineChatMessage {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    streaming: message.streaming,
    ...(message.diffPatch ? { diffPatch: message.diffPatch } : {}),
    ...(message.changedFiles && message.changedFiles.length > 0
      ? { changedFiles: message.changedFiles }
      : {}),
  }
}

export function deriveTimelineEntriesFromThread(thread: AgentThread): TimelineEntry[] {
  // Empty `timeline: []` is the server default for new threads — treat as unset so
  // legacy `messages` remain the source of truth until structured items arrive.
  const structured = thread.timeline ?? []
  const fromMessages: TimelineEntry[] = [...thread.messages]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map(message => ({
      id: message.id,
      kind: "message" as const,
      createdAt: message.createdAt,
      message: agentMessageToTimelineChatMessage(message),
    }))
  if (structured.length === 0) {
    return fromMessages
  }
  const messageIds = new Set(
    fromMessages.flatMap(entry => (entry.kind === "message" ? [entry.id] : [])),
  )
  const fromStructured: TimelineEntry[] = []
  for (const item of [...structured].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  )) {
    if (item.kind === "user" || item.kind === "assistant" || item.kind === "system") {
      if (messageIds.has(item.id)) continue
      fromStructured.push({
        id: item.id,
        kind: "message",
        createdAt: item.createdAt,
        message: {
          id: item.id,
          role: item.kind,
          text: item.text,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt ?? item.createdAt,
          streaming: item.streaming ?? false,
        },
      })
      continue
    }
    fromStructured.push({
      id: item.id,
      kind: "structured",
      createdAt: item.createdAt,
      item,
    })
  }
  return [...fromMessages, ...fromStructured].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  )
}

export function buildTurnDiffSummaryByAssistantMessageId(
  thread: AgentThread,
): Map<string, TurnDiffSummary> {
  const map = new Map<string, TurnDiffSummary>()
  for (const message of thread.messages) {
    if (message.role !== "assistant") continue
    if (!message.changedFiles || message.changedFiles.length === 0) continue
    map.set(message.id, {
      turnId: message.id,
      completedAt: message.updatedAt,
      files: message.changedFiles,
    })
  }
  return map
}
