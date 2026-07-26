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
    ...(message.attachments?.length ? { attachments: message.attachments } : {}),
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
  const canonicalMessageCounts = new Map<string, number>()
  for (const entry of fromMessages) {
    if (entry.kind !== "message") continue
    const key = `${entry.message.role}\u0000${entry.message.text}`
    canonicalMessageCounts.set(key, (canonicalMessageCounts.get(key) ?? 0) + 1)
  }
  const fromStructured: TimelineEntry[] = []
  for (const item of [...structured].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  )) {
    if (item.kind === "user" || item.kind === "assistant" || item.kind === "system") {
      if (messageIds.has(item.id)) continue
      // ACP text is also persisted into the canonical `messages` stream.
      // Older threads may contain the same text under a transport event id;
      // keep exactly one visible chat message while retaining true
      // structured-only transcripts.
      const contentKey = `${item.kind}\u0000${item.text}`
      const canonicalCount = canonicalMessageCounts.get(contentKey) ?? 0
      if (canonicalCount > 0) {
        canonicalMessageCounts.set(contentKey, canonicalCount - 1)
        continue
      }
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
