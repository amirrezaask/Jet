import type {
  AgentStructuredDelta,
  AgentThread,
  AgentThreadDelta,
  AgentTimelineItem,
} from "./types.js"

const TERMINAL_STATUSES = new Set<AgentThread["status"]>([
  "idle",
  "cancelled",
  "disconnected",
  "error",
])

function timestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Merge a persisted/full host snapshot without letting a late event roll a
 * conversation back behind a structured or terminal state already rendered.
 */
export function mergeAgentThreadSnapshot(
  current: AgentThread | null,
  incoming: AgentThread,
): AgentThread {
  if (!current || current.id !== incoming.id) return incoming
  const currentSequence = current.acpSequence ?? -1
  const incomingSequence = incoming.acpSequence ?? -1
  if (incomingSequence < currentSequence) return current
  if (
    incomingSequence === currentSequence &&
    timestamp(incoming.updatedAt) < timestamp(current.updatedAt)
  ) {
    return current
  }
  return incoming
}

export function applyAgentThreadDelta(
  current: AgentThread | null,
  delta: AgentThreadDelta,
): AgentThread | null {
  if (!current || current.id !== delta.threadId) return current
  const currentIsNewer = timestamp(current.updatedAt) > timestamp(delta.updatedAt)
  const preserveTerminalStatus =
    TERMINAL_STATUSES.has(current.status) && delta.status === "running"
  if (currentIsNewer && preserveTerminalStatus) return current

  let foundMessage = false
  const messages = current.messages.map(message => {
    if (message.id !== delta.messageId) return message
    foundMessage = true
    return {
      ...message,
      text: delta.text,
      streaming: delta.streaming,
      updatedAt: delta.updatedAt,
    }
  })
  if (!foundMessage) {
    messages.push({
      id: delta.messageId,
      role: "assistant",
      text: delta.text,
      createdAt: delta.updatedAt,
      updatedAt: delta.updatedAt,
      streaming: delta.streaming,
    })
  }

  return {
    ...current,
    updatedAt:
      timestamp(delta.updatedAt) >= timestamp(current.updatedAt)
        ? delta.updatedAt
        : current.updatedAt,
    status: preserveTerminalStatus ? current.status : delta.status,
    lastError: preserveTerminalStatus ? current.lastError : delta.lastError,
    messages,
  }
}

function upsertTimelineItem(
  timeline: AgentTimelineItem[],
  item: AgentTimelineItem,
): void {
  const index = timeline.findIndex(candidate => candidate.id === item.id)
  if (index === -1) timeline.push(item)
  else timeline[index] = item
}

export function applyAgentStructuredDelta(
  current: AgentThread | null,
  delta: AgentStructuredDelta,
): AgentThread | null {
  if (!current || current.id !== delta.threadId) return current
  if ((current.acpSequence ?? -1) >= delta.sequence) return current

  const timeline = [...(current.timeline ?? [])]
  for (const item of delta.created ?? []) upsertTimelineItem(timeline, item)
  for (const item of delta.updated ?? []) upsertTimelineItem(timeline, item)

  return {
    ...current,
    timeline,
    updatedAt: delta.updatedAt,
    acpSequence: delta.sequence,
    ...(delta.status ? { status: delta.status } : {}),
    ...(delta.lastError !== undefined ? { lastError: delta.lastError } : {}),
    ...(delta.pendingPermissions ? { pendingPermissions: delta.pendingPermissions } : {}),
    ...(delta.pendingUserInputs ? { pendingUserInputs: delta.pendingUserInputs } : {}),
    ...(delta.usage !== undefined ? { usage: delta.usage } : {}),
    ...(delta.plan !== undefined ? { plan: delta.plan } : {}),
    ...(delta.connection !== undefined ? { connection: delta.connection } : {}),
    ...(delta.configOptions !== undefined ? { configOptions: delta.configOptions } : {}),
    ...(delta.discoveredModels !== undefined
      ? { discoveredModels: delta.discoveredModels }
      : {}),
    ...(delta.sessionModes !== undefined ? { sessionModes: delta.sessionModes } : {}),
  }
}
