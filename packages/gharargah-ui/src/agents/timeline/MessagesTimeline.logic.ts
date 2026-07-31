export * from "./timelineScrollAnchoring.js"

import { aggregateToolCalls } from "./activityAggregation.js"

export interface TimelineEndState {
  readonly isAtEnd?: boolean
  readonly isNearEnd?: boolean
}

export function resolveTimelineIsAtEnd(state: TimelineEndState | undefined): boolean | undefined {
  return state?.isNearEnd ?? state?.isAtEnd
}

export type TimelineLatestTurn = {
  turnId: string
  state: "running" | "completed" | "failed" | "interrupted" | "cancelled"
  startedAt: string | null
  completedAt: string | null
}

export interface TimelineDurationMessage {
  id: string
  role: "user" | "assistant" | "system"
  createdAt: string
  updatedAt: string
  streaming: boolean
}

const ACTIVE_THREAD_STATUSES = new Set([
  "connecting",
  "authenticating",
  "running",
  "waiting_for_permission",
  "cancelling",
  "reconnecting",
])

export function deriveTimelineTurnFromThread(
  thread: import("@gharargah/agents").AgentThread,
): {
  latestTurn: TimelineLatestTurn | null
  runningTurnId: string | null
} {
  const messages = thread.messages
  const lastUser = [...messages].reverse().find(message => message.role === "user")
  const lastAssistant = [...messages].reverse().find(message => message.role === "assistant")

  const turnId = lastAssistant?.id ?? lastUser?.id ?? null

  if (!turnId) {
    return { latestTurn: null, runningTurnId: null }
  }

  const isActive = ACTIVE_THREAD_STATUSES.has(thread.status)
  let state: TimelineLatestTurn["state"]
  if (isActive) {
    state = "running"
  } else if (thread.status === "cancelled") {
    state = "cancelled"
  } else if (thread.status === "interrupted") {
    state = "interrupted"
  } else if (thread.status === "error" || thread.status === "disconnected") {
    state = "failed"
  } else {
    state = "completed"
  }

  return {
    latestTurn: {
      turnId,
      state,
      startedAt: lastUser?.createdAt ?? lastAssistant?.createdAt ?? null,
      completedAt: isActive ? null : (lastAssistant?.updatedAt ?? thread.updatedAt),
    },
    runningTurnId: isActive ? turnId : null,
  }
}

export type MessagesTimelineRow =
  | {
      kind: "message"
      id: string
      createdAt: string
      message: import("@gharargah/agents").TimelineChatMessage
      durationStart: string
      showAssistantMeta: boolean
      showAssistantCopyButton: boolean
      assistantCopyStreaming: boolean
      assistantTurnDiffSummary?: import("@gharargah/agents").TurnDiffSummary
      revertTurnCount?: number
    }
  | { kind: "working"; id: string; createdAt: string | null; label: string }
  | {
      kind: "turn_status"
      id: string
      createdAt: string
      status: "completed" | "failed" | "cancelled"
      label: string
    }
  | {
      kind: "activity_group"
      id: string
      createdAt: string
      label: string
      toolCalls: ReadonlyArray<import("@gharargah/agents").AgentToolCall>
      diffStat: { additions: number; deletions: number } | null
      editFileCount: number
      changedFiles: ReadonlyArray<import("@gharargah/agents").AgentFileChange>
      hasFailure: boolean
    }
  | {
      kind: "structured"
      id: string
      createdAt: string
      item: import("@gharargah/agents").AgentTimelineItem
    }

export interface StableMessagesTimelineRowsState {
  byId: Map<string, MessagesTimelineRow>
  result: MessagesTimelineRow[]
}

export function computeMessageDurationStart(
  messages: ReadonlyArray<TimelineDurationMessage>,
): Map<string, string> {
  const result = new Map<string, string>()
  let lastBoundary: string | null = null
  for (const message of messages) {
    if (message.role === "user") {
      lastBoundary = message.createdAt
    }
    result.set(message.id, lastBoundary ?? message.createdAt)
    if (message.role === "assistant" && !message.streaming) {
      lastBoundary = message.updatedAt
    }
  }
  return result
}

export function coerceMessageText(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) {
    return value.map(coerceMessageText).filter(Boolean).join("")
  }
  if (typeof value === "object") {
    const record = value as { text?: unknown; content?: unknown }
    if (record.text != null) return coerceMessageText(record.text)
    if (record.content != null) return coerceMessageText(record.content)
  }
  return ""
}

export function resolveAssistantMessageCopyState(input: {
  text: string | null | unknown
  showCopyButton: boolean
  streaming: boolean
}) {
  const normalized = input.text == null ? null : coerceMessageText(input.text)
  const hasText = normalized !== null && normalized.trim().length > 0
  return {
    text: hasText ? normalized : null,
    visible: input.showCopyButton && hasText && !input.streaming,
  }
}

function deriveTerminalAssistantMessageIds(
  timelineEntries: ReadonlyArray<import("@gharargah/agents").TimelineEntry>,
): Set<string> {
  const lastAssistantMessageIdByResponseKey = new Map<string, string>()
  let nullTurnResponseIndex = 0

  for (const timelineEntry of timelineEntries) {
    if (timelineEntry.kind !== "message") continue
    const { message } = timelineEntry
    if (message.role === "user") {
      nullTurnResponseIndex += 1
      continue
    }
    if (message.role !== "assistant") continue
    const responseKey = message.turnId
      ? `turn:${message.turnId}`
      : `unkeyed:${nullTurnResponseIndex}`
    lastAssistantMessageIdByResponseKey.set(responseKey, message.id)
  }

  return new Set(lastAssistantMessageIdByResponseKey.values())
}

export function deriveMessagesTimelineRows(input: {
  timelineEntries: ReadonlyArray<import("@gharargah/agents").TimelineEntry>
  latestTurn?: TimelineLatestTurn | null
  runningTurnId?: string | null
  isWorking: boolean
  workingLabel: string
  activeTurnStartedAt: string | null
  turnDiffSummaryByAssistantMessageId: ReadonlyMap<string, import("@gharargah/agents").TurnDiffSummary>
  revertTurnCountByUserMessageId?: ReadonlyMap<string, number>
}): MessagesTimelineRow[] {
  const nextRows: MessagesTimelineRow[] = []
  const durationStartByMessageId = computeMessageDurationStart(
    input.timelineEntries.flatMap(entry => (entry.kind === "message" ? [entry.message] : [])),
  )
  const terminalAssistantMessageIds = deriveTerminalAssistantMessageIds(input.timelineEntries)
  const unsettledTurnId =
    input.runningTurnId ??
    (input.latestTurn &&
    !(input.latestTurn.completedAt !== null && input.latestTurn.state !== "running")
      ? input.latestTurn.turnId
      : null)

  type ToolBuffer = {
    tools: import("@gharargah/agents").AgentToolCall[]
    firstId: string
    createdAt: string
  }
  let toolBuffer: ToolBuffer | null = null
  let pendingTurnDiff: import("@gharargah/agents").TurnDiffSummary | null = null
  let lastUserMessageId: string | null = null
  let segmentHasPostUserContent = false
  let segmentEmittedEdit = false
  let turnStatusEmittedForUser: string | null = null

  const flushTools = () => {
    if (!toolBuffer || toolBuffer.tools.length === 0) {
      toolBuffer = null
      return
    }
    const aggregated = aggregateToolCalls({
      id: `activity:${toolBuffer.firstId}`,
      createdAt: toolBuffer.createdAt,
      toolCalls: toolBuffer.tools,
      turnDiffSummary: pendingTurnDiff,
    })
    toolBuffer = null
    if (!aggregated) return
    nextRows.push({
      kind: "activity_group",
      id: aggregated.id,
      createdAt: aggregated.createdAt,
      label: aggregated.label,
      toolCalls: aggregated.toolCalls,
      diffStat: aggregated.diffStat,
      editFileCount: aggregated.editFileCount,
      changedFiles: aggregated.changedFiles,
      hasFailure: aggregated.hasFailure,
    })
    if (aggregated.editFileCount > 0) segmentEmittedEdit = true
    segmentHasPostUserContent = true
  }

  for (const timelineEntry of input.timelineEntries) {
    if (timelineEntry.kind === "structured") {
      if (timelineEntry.item.kind === "tool_call") {
        if (!toolBuffer) {
          toolBuffer = {
            tools: [],
            firstId: timelineEntry.id,
            createdAt: timelineEntry.createdAt,
          }
        }
        toolBuffer.tools.push(timelineEntry.item.toolCall)
        continue
      }
      flushTools()
      nextRows.push({
        kind: "structured",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        item: timelineEntry.item,
      })
      segmentHasPostUserContent = true
      continue
    }
    if (timelineEntry.kind !== "message") continue

    flushTools()

    const assistantTurnStillInProgress =
      timelineEntry.message.role === "assistant" &&
      unsettledTurnId !== null &&
      (timelineEntry.message.turnId === unsettledTurnId ||
        timelineEntry.message.id === unsettledTurnId)

    const durationStart =
      durationStartByMessageId.get(timelineEntry.message.id) ?? timelineEntry.message.createdAt

    const showAssistantMeta =
      timelineEntry.message.role === "assistant" &&
      terminalAssistantMessageIds.has(timelineEntry.message.id) &&
      !assistantTurnStillInProgress

    if (timelineEntry.message.role === "user") {
      lastUserMessageId = timelineEntry.message.id
      segmentHasPostUserContent = false
      segmentEmittedEdit = false
      turnStatusEmittedForUser = null
      pendingTurnDiff = null
    }

    const assistantTurnDiff =
      timelineEntry.message.role === "assistant"
        ? input.turnDiffSummaryByAssistantMessageId.get(timelineEntry.message.id)
        : undefined
    if (assistantTurnDiff) {
      pendingTurnDiff = assistantTurnDiff
    }

    nextRows.push({
      kind: "message",
      id: timelineEntry.id,
      createdAt: timelineEntry.createdAt,
      message: timelineEntry.message,
      durationStart,
      showAssistantMeta,
      showAssistantCopyButton: showAssistantMeta,
      assistantCopyStreaming: timelineEntry.message.streaming || assistantTurnStillInProgress,
      assistantTurnDiffSummary: undefined,
      revertTurnCount:
        timelineEntry.message.role === "user"
          ? input.revertTurnCountByUserMessageId?.get(timelineEntry.message.id)
          : undefined,
    })

    if (timelineEntry.message.role === "assistant") {
      segmentHasPostUserContent = true
      if (assistantTurnDiff && assistantTurnDiff.files.length > 0) {
        const files = assistantTurnDiff.files
        const diffStat = files.reduce(
          (acc, file) => ({
            additions: acc.additions + file.additions,
            deletions: acc.deletions + file.deletions,
          }),
          { additions: 0, deletions: 0 },
        )
        const lastActivityIndex = (() => {
          for (let i = nextRows.length - 1; i >= 0; i -= 1) {
            const row = nextRows[i]
            if (row?.kind === "activity_group") return i
            if (row?.kind === "message" && row.message.role === "user") break
          }
          return -1
        })()
        if (lastActivityIndex >= 0) {
          const existing = nextRows[lastActivityIndex]
          if (existing?.kind === "activity_group") {
            nextRows[lastActivityIndex] = {
              ...existing,
              editFileCount: Math.max(existing.editFileCount, files.length),
              diffStat:
                diffStat.additions > 0 || diffStat.deletions > 0
                  ? diffStat
                  : existing.diffStat,
              changedFiles:
                existing.changedFiles.length > 0 ? existing.changedFiles : files,
              label:
                existing.editFileCount > 0 || existing.label.toLowerCase().includes("edit")
                  ? existing.label
                  : `${existing.label}, edited ${files.length} ${files.length === 1 ? "file" : "files"}`,
            }
            segmentEmittedEdit = true
          }
        } else if (!segmentEmittedEdit) {
          nextRows.push({
            kind: "activity_group",
            id: `activity:diff:${timelineEntry.id}`,
            createdAt: timelineEntry.createdAt,
            label: `Edited ${files.length} ${files.length === 1 ? "file" : "files"}`,
            toolCalls: [],
            diffStat: diffStat.additions > 0 || diffStat.deletions > 0 ? diffStat : null,
            editFileCount: files.length,
            changedFiles: files,
            hasFailure: false,
          })
          segmentEmittedEdit = true
        }
      }
    }
  }

  flushTools()

  if (input.isWorking) {
    nextRows.push({
      kind: "working",
      id: "working-indicator-row",
      createdAt: input.activeTurnStartedAt,
      label: input.workingLabel,
    })
  } else if (lastUserMessageId && segmentHasPostUserContent) {
    const userIndex = nextRows.findIndex(
      row => row.kind === "message" && row.message.id === lastUserMessageId,
    )
    if (userIndex >= 0 && turnStatusEmittedForUser !== lastUserMessageId) {
      const turnState = input.latestTurn?.state
      let status: Extract<MessagesTimelineRow, { kind: "turn_status" }>["status"] = "completed"
      let label = "Completed"
      if (turnState === "failed") {
        status = "failed"
        label = "Failed"
      } else if (turnState === "cancelled") {
        status = "cancelled"
        label = "Cancelled"
      } else if (turnState === "interrupted") {
        status = "failed"
        label = "Stopped"
      }
      nextRows.splice(userIndex + 1, 0, {
        kind: "turn_status",
        id: `turn-status:${lastUserMessageId}`,
        createdAt: input.activeTurnStartedAt ?? new Date().toISOString(),
        status,
        label,
      })
    }
  }

  return nextRows
}

function isRowUnchanged(a: MessagesTimelineRow, b: MessagesTimelineRow): boolean {
  if (a.kind !== b.kind || a.id !== b.id) return false
  if (a.kind === "working") {
    const next = b as typeof a
    return a.createdAt === next.createdAt && a.label === next.label
  }
  if (a.kind === "turn_status") {
    const next = b as typeof a
    return a.status === next.status && a.label === next.label && a.createdAt === next.createdAt
  }
  if (a.kind === "activity_group") {
    const next = b as typeof a
    return (
      a.label === next.label &&
      a.createdAt === next.createdAt &&
      a.editFileCount === next.editFileCount &&
      a.hasFailure === next.hasFailure &&
      a.changedFiles === next.changedFiles &&
      a.diffStat?.additions === next.diffStat?.additions &&
      a.diffStat?.deletions === next.diffStat?.deletions &&
      a.toolCalls === next.toolCalls
    )
  }
  if (a.kind === "structured") {
    const next = b as Extract<MessagesTimelineRow, { kind: "structured" }>
    if (a.item.id !== next.item.id || a.item.kind !== next.item.kind) return false
    if (a.item.kind === "thought" && next.item.kind === "thought") {
      return a.item.text === next.item.text
    }
    return a.item === next.item
  }
  const bm = b as Extract<MessagesTimelineRow, { kind: "message" }>
  return (
    a.message === bm.message &&
    a.durationStart === bm.durationStart &&
    a.showAssistantMeta === bm.showAssistantMeta &&
    a.showAssistantCopyButton === bm.showAssistantCopyButton &&
    a.assistantCopyStreaming === bm.assistantCopyStreaming &&
    a.assistantTurnDiffSummary === bm.assistantTurnDiffSummary &&
    a.revertTurnCount === bm.revertTurnCount
  )
}

export function computeStableMessagesTimelineRows(
  rows: MessagesTimelineRow[],
  previous: StableMessagesTimelineRowsState,
): StableMessagesTimelineRowsState {
  const next = new Map<string, MessagesTimelineRow>()
  let anyChanged = rows.length !== previous.byId.size

  const result = rows.map((row, index) => {
    const prevRow = previous.byId.get(row.id)
    const nextRow = prevRow && isRowUnchanged(prevRow, row) ? prevRow : row
    next.set(row.id, nextRow)
    if (!anyChanged && previous.result[index] !== nextRow) {
      anyChanged = true
    }
    return nextRow
  })

  return anyChanged ? { byId: next, result } : previous
}

function formatShortTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
}

export function formatTimelineTimestamp(iso: string): string {
  return formatShortTimestamp(iso)
}
