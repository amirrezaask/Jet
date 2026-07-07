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
  return [...thread.messages]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map(message => ({
      id: message.id,
      kind: "message" as const,
      createdAt: message.createdAt,
      message: agentMessageToTimelineChatMessage(message),
    }))
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
