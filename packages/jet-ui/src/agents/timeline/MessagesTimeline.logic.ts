export * from "./timelineScrollAnchoring.js"

export const TIMELINE_MINIMAP_ITEM_SPACING = 8
export const TIMELINE_MINIMAP_MIN_ITEMS = 2
export const TIMELINE_MINIMAP_MAX_HEIGHT_CSS = "calc(100vh - 18rem)"
export const TIMELINE_CONTENT_MAX_WIDTH = 768
export const TIMELINE_MINIMAP_PERSISTENT_GUTTER = 48

export interface TimelineEndState {
  readonly isAtEnd?: boolean
  readonly isNearEnd?: boolean
}

export function resolveTimelineIsAtEnd(state: TimelineEndState | undefined): boolean | undefined {
  return state?.isNearEnd ?? state?.isAtEnd
}

export function resolveTimelineMinimapHeightStyle(itemCount: number): string {
  const naturalHeight = Math.max(1, (itemCount - 1) * TIMELINE_MINIMAP_ITEM_SPACING)
  return `min(${naturalHeight}px, ${TIMELINE_MINIMAP_MAX_HEIGHT_CSS})`
}

export function resolveTimelineMinimapTopPercent(index: number, itemCount: number): number {
  if (itemCount <= 1) {
    return 0
  }
  return (Math.max(0, Math.min(index, itemCount - 1)) / (itemCount - 1)) * 100
}

export function resolveTimelineMinimapIndexFromPointer(input: {
  readonly itemCount: number
  readonly railTop: number
  readonly railHeight: number
  readonly pointerY: number
}): number | null {
  if (input.itemCount <= 0 || input.railHeight <= 0) {
    return null
  }
  if (input.itemCount === 1) {
    return 0
  }
  const progress = Math.max(0, Math.min(1, (input.pointerY - input.railTop) / input.railHeight))
  return Math.max(0, Math.min(input.itemCount - 1, Math.round(progress * (input.itemCount - 1))))
}

export function resolveTimelineMinimapHasPersistentGutter(viewportWidth: number): boolean {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return false
  }
  const contentWidth = Math.min(viewportWidth, TIMELINE_CONTENT_MAX_WIDTH)
  const sideGutter = Math.max(0, (viewportWidth - contentWidth) / 2)
  return sideGutter >= TIMELINE_MINIMAP_PERSISTENT_GUTTER
}

export interface TimelineDurationMessage {
  id: string
  role: "user" | "assistant" | "system"
  createdAt: string
  updatedAt: string
  streaming: boolean
}

export type TimelineLatestTurn = {
  turnId: string
  state: "running" | "completed" | "failed" | "interrupted" | "cancelled"
  startedAt: string | null
  completedAt: string | null
}

export type MessagesTimelineRow =
  | {
      kind: "message"
      id: string
      createdAt: string
      message: import("@jet/agents").TimelineChatMessage
      durationStart: string
      showAssistantMeta: boolean
      showAssistantCopyButton: boolean
      assistantCopyStreaming: boolean
      assistantTurnDiffSummary?: import("@jet/agents").TurnDiffSummary
      revertTurnCount?: number
    }
  | { kind: "working"; id: string; createdAt: string | null }

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

export function resolveAssistantMessageCopyState(input: {
  text: string | null
  showCopyButton: boolean
  streaming: boolean
}) {
  const hasText = input.text !== null && input.text.trim().length > 0
  return {
    text: hasText ? input.text : null,
    visible: input.showCopyButton && hasText && !input.streaming,
  }
}

function deriveTerminalAssistantMessageIds(
  timelineEntries: ReadonlyArray<import("@jet/agents").TimelineEntry>,
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
  timelineEntries: ReadonlyArray<import("@jet/agents").TimelineEntry>
  latestTurn?: TimelineLatestTurn | null
  runningTurnId?: string | null
  isWorking: boolean
  activeTurnStartedAt: string | null
  turnDiffSummaryByAssistantMessageId: ReadonlyMap<string, import("@jet/agents").TurnDiffSummary>
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

  for (const timelineEntry of input.timelineEntries) {
    if (timelineEntry.kind !== "message") continue

    const assistantTurnStillInProgress =
      timelineEntry.message.role === "assistant" &&
      unsettledTurnId !== null &&
      timelineEntry.message.turnId === unsettledTurnId

    const durationStart =
      durationStartByMessageId.get(timelineEntry.message.id) ?? timelineEntry.message.createdAt

    const showAssistantMeta =
      timelineEntry.message.role === "assistant" &&
      terminalAssistantMessageIds.has(timelineEntry.message.id) &&
      !assistantTurnStillInProgress

    nextRows.push({
      kind: "message",
      id: timelineEntry.id,
      createdAt: timelineEntry.createdAt,
      message: timelineEntry.message,
      durationStart,
      showAssistantMeta,
      showAssistantCopyButton: showAssistantMeta,
      assistantCopyStreaming: timelineEntry.message.streaming || assistantTurnStillInProgress,
      assistantTurnDiffSummary:
        timelineEntry.message.role === "assistant"
          ? input.turnDiffSummaryByAssistantMessageId.get(timelineEntry.message.id)
          : undefined,
      revertTurnCount:
        timelineEntry.message.role === "user"
          ? input.revertTurnCountByUserMessageId?.get(timelineEntry.message.id)
          : undefined,
    })
  }

  if (input.isWorking) {
    nextRows.push({
      kind: "working",
      id: "working-indicator-row",
      createdAt: input.activeTurnStartedAt,
    })
  }

  return nextRows
}

function isRowUnchanged(a: MessagesTimelineRow, b: MessagesTimelineRow): boolean {
  if (a.kind !== b.kind || a.id !== b.id) return false
  if (a.kind === "working") {
    return a.createdAt === (b as typeof a).createdAt
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

export interface TimelineMinimapItem {
  readonly id: string
  readonly rowIndex: number
  readonly userText: string | null
  readonly assistantText: string | null
}

export function deriveTimelineMinimapItems(rows: MessagesTimelineRow[]): TimelineMinimapItem[] {
  const items: TimelineMinimapItem[] = []
  let pendingUser: { id: string; text: string } | null = null

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]
    if (!row || row.kind !== "message") continue
    if (row.message.role === "user") {
      pendingUser = { id: row.message.id, text: row.message.text.trim() }
      continue
    }
    if (row.message.role !== "assistant" || !row.showAssistantMeta) continue
    items.push({
      id: row.message.id,
      rowIndex,
      userText: pendingUser?.text ?? null,
      assistantText: row.message.text.trim() || null,
    })
    pendingUser = null
  }

  return items
}

function formatShortTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
}

export function formatTimelineTimestamp(iso: string): string {
  return formatShortTimestamp(iso)
}
