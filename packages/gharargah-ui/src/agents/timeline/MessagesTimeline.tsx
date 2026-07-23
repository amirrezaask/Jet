import type { TimelineEntry, TurnDiffSummary } from "@gharargah/agents"
import { LegendList, type LegendListRef } from "@legendapp/list/react"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { cn } from "../../lib/utils.js"
import { Button } from "../../components/ui/button.js"
import { AgentMarkdown } from "../AgentMarkdown.js"
import { AgentPatchView } from "../AgentPatchView.js"
import { ChangedFilesTree } from "../ChangedFilesTree.js"
import { DiffStatLabel, hasNonZeroStat } from "../DiffStatLabel.js"
import { summarizeTurnDiffStats } from "../turnDiffTree.js"
import { MessageCopyButton } from "./MessageCopyButton.js"
import { ThoughtBlock } from "./ThoughtBlock.js"
import { ToolCallCard } from "./ToolCallCard.js"
import { PermissionCard } from "./PermissionCard.js"
import { PlanCard } from "./PlanCard.js"
import { UsageMeter } from "./UsageMeter.js"
import {
  computeStableMessagesTimelineRows,
  deriveMessagesTimelineRows,
  formatTimelineTimestamp,
  resolveAssistantMessageCopyState,
  resolveTimelineIsAtEnd,
  type MessagesTimelineRow,
  type StableMessagesTimelineRowsState,
} from "./MessagesTimeline.logic.js"

const TIMELINE_LIST_HEADER = <div className="h-3 sm:h-4" />
const TIMELINE_LIST_FOOTER = <div className="h-3 sm:h-4" />

const EMPTY_STABLE_ROWS: StableMessagesTimelineRowsState = {
  byId: new Map(),
  result: [],
}

function useStableRows(rows: MessagesTimelineRow[]): MessagesTimelineRow[] {
  const stateRef = useRef(EMPTY_STABLE_ROWS)
  const stable = useMemo(() => {
    const next = computeStableMessagesTimelineRows(rows, stateRef.current)
    stateRef.current = next
    return next.result
  }, [rows])
  return stable
}

function UserTimelineRow(props: { row: Extract<MessagesTimelineRow, { kind: "message" }> }) {
  const { row } = props
  const copyText = row.message.text.trim()
  return (
    <div className="group flex flex-col items-end gap-1">
      <div className="relative max-w-[80%] rounded-2xl border border-border bg-secondary p-3">
        <p className="whitespace-pre-wrap text-sm text-foreground">{row.message.text}</p>
      </div>
      <div className="flex w-full max-w-[80%] items-center justify-end pe-1 text-xs tabular-nums opacity-0 transition-opacity duration-[var(--gharargah-motion-menu)] focus-within:opacity-100 group-hover:opacity-100">
        <div className="flex shrink-0 items-center gap-2">
          <p className="text-muted-foreground text-xs tabular-nums">
            {formatTimelineTimestamp(row.message.createdAt)}
          </p>
          {copyText ? <MessageCopyButton text={copyText} variant="ghost" /> : null}
        </div>
      </div>
    </div>
  )
}

function AssistantChangedFilesSection(props: {
  turnSummary: TurnDiffSummary
  allDirectoriesExpanded: boolean
  onToggleAllDirectories: () => void
}) {
  const { turnSummary, allDirectoriesExpanded, onToggleAllDirectories } = props
  const files = [...turnSummary.files]
  const summaryStat = summarizeTurnDiffStats(files)

  return (
    <div className="mt-2 rounded-lg border bg-card p-2.5">
      <div className="sticky top-2 z-10 mb-1.5 flex items-center justify-between gap-2 bg-card before:absolute before:inset-x-0 before:-top-2 before:h-2 before:bg-card before:content-['']">
        <p className="text-3xs uppercase tracking-[0.12em] text-muted-foreground/65">
          <span>Changed files ({files.length})</span>
          {hasNonZeroStat(summaryStat) ? (
            <>
              <span className="mx-1">•</span>
              <DiffStatLabel additions={summaryStat.additions} deletions={summaryStat.deletions} />
            </>
          ) : null}
        </p>
        <Button
          type="button"
          size="xs"
          variant="outline"
          data-scroll-anchor-ignore
          onClick={onToggleAllDirectories}
        >
          {allDirectoriesExpanded ? "Collapse all" : "Expand all"}
        </Button>
      </div>
      <ChangedFilesTree files={files} allDirectoriesExpanded={allDirectoriesExpanded} />
    </div>
  )
}

function AssistantTimelineRow(props: {
  row: Extract<MessagesTimelineRow, { kind: "message" }>
  theme: "light" | "dark"
  expandAll: boolean
  onToggleAllDirectories: () => void
}) {
  const { row, theme, expandAll, onToggleAllDirectories } = props
  const messageText = row.message.text || (row.message.streaming ? "" : "(empty response)")
  const assistantCopyState = resolveAssistantMessageCopyState({
    text: row.message.text ?? null,
    showCopyButton: row.showAssistantCopyButton,
    streaming: row.assistantCopyStreaming,
  })

  return (
    <div className="relative min-w-0 px-1 py-0.5">
      <AgentMarkdown text={messageText} theme={theme} />
      {row.assistantTurnDiffSummary ? (
        <AssistantChangedFilesSection
          turnSummary={row.assistantTurnDiffSummary}
          allDirectoriesExpanded={expandAll}
          onToggleAllDirectories={onToggleAllDirectories}
        />
      ) : null}
      {row.message.diffPatch ? (
        <div className="mt-4 overflow-hidden rounded-xl border border-input bg-card">
          <AgentPatchView patch={row.message.diffPatch} theme={theme} />
        </div>
      ) : null}
      {row.showAssistantMeta ? (
        <div className="mt-1.5 flex items-center gap-2 text-xs tabular-nums opacity-0 transition-opacity duration-[var(--gharargah-motion-menu)] focus-within:opacity-100 group-hover/assistant:opacity-100">
          {assistantCopyState.visible ? (
            <MessageCopyButton text={assistantCopyState.text ?? ""} variant="ghost" />
          ) : null}
          {!row.message.streaming ? (
            <p className="text-muted-foreground text-xs tabular-nums">
              {formatTimelineTimestamp(row.message.updatedAt)}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function WorkingTimelineRow(props: { row: Extract<MessagesTimelineRow, { kind: "working" }> }) {
  return (
    <div className="py-0.5 pl-1.5">
      <div className="flex items-center gap-2 pt-1 text-3xs text-muted-foreground/70 tabular-nums">
        <span className="inline-flex items-center gap-[3px]">
          <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-pulse" />
          <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-pulse [animation-delay:200ms]" />
          <span className="h-1 w-1 rounded-full bg-muted-foreground/30 animate-pulse [animation-delay:400ms]" />
        </span>
        <span>Working...</span>
      </div>
    </div>
  )
}

function StructuredTimelineRow(props: {
  row: Extract<MessagesTimelineRow, { kind: "structured" }>
  onResolvePermission?: (permissionId: string, decision: "allow_once" | "allow_always" | "reject") => void
}) {
  const { item } = props.row
  if (item.kind === "thought") return <ThoughtBlock text={item.text} />
  if (item.kind === "tool_call") return <ToolCallCard toolCall={item.toolCall} />
  if (item.kind === "permission") {
    return <PermissionCard permission={item.permission} onResolve={({ permissionId, decision }) => props.onResolvePermission?.(permissionId, decision)} />
  }
  if (item.kind === "plan") return <PlanCard plan={item.plan} />
  if (item.kind === "usage") return <UsageMeter usage={item.usage} />
  return <p className={item.kind === "error" ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{item.text}</p>
}

function TimelineRowContent(props: {
  row: MessagesTimelineRow
  theme: "light" | "dark"
  expandAll: boolean
  onToggleAllDirectories: () => void
  onResolvePermission?: (permissionId: string, decision: "allow_once" | "allow_always" | "reject") => void
}) {
  const { row, theme, expandAll, onToggleAllDirectories } = props
  return (
    <div
      className={cn(
        row.kind === "message" && row.message.role === "assistant" && !row.showAssistantMeta
          ? "pb-2"
          : "pb-4",
        row.kind === "message" && row.message.role === "assistant" ? "group/assistant" : null,
      )}
      data-timeline-row-id={row.id}
      data-timeline-row-kind={row.kind}
      data-message-id={row.kind === "message" ? row.message.id : undefined}
      data-message-role={row.kind === "message" ? row.message.role : undefined}
    >
      {row.kind === "message" && row.message.role === "user" ? (
        <UserTimelineRow row={row} />
      ) : null}
      {row.kind === "message" && row.message.role === "assistant" ? (
        <AssistantTimelineRow
          row={row}
          theme={theme}
          expandAll={expandAll}
          onToggleAllDirectories={onToggleAllDirectories}
        />
      ) : null}
      {row.kind === "working" ? <WorkingTimelineRow row={row} /> : null}
      {row.kind === "structured" ? <StructuredTimelineRow row={row} onResolvePermission={props.onResolvePermission} /> : null}
    </div>
  )
}

export const MessagesTimeline = memo(function MessagesTimeline(props: {
  listRef?: React.RefObject<LegendListRef | null>
  timelineEntries: ReadonlyArray<TimelineEntry>
  turnDiffSummaryByAssistantMessageId: ReadonlyMap<string, TurnDiffSummary>
  isWorking: boolean
  activeTurnStartedAt?: string | null
  theme: "light" | "dark"
  contentInsetEndAdjustment: number
  expandAll: boolean
  onToggleAllDirectories: () => void
  onIsAtEndChange?: (isAtEnd: boolean) => void
  onResolvePermission?: (permissionId: string, decision: "allow_once" | "allow_always" | "reject") => void
}) {
  const {
    listRef: externalListRef,
    timelineEntries,
    turnDiffSummaryByAssistantMessageId,
    isWorking,
    activeTurnStartedAt = null,
    theme,
    contentInsetEndAdjustment,
    expandAll,
    onToggleAllDirectories,
    onIsAtEndChange,
    onResolvePermission,
  } = props

  const internalListRef = useRef<LegendListRef | null>(null)
  const listRef = externalListRef ?? internalListRef

  const rawRows = useMemo(
    () =>
      deriveMessagesTimelineRows({
        timelineEntries,
        isWorking,
        activeTurnStartedAt,
        turnDiffSummaryByAssistantMessageId,
      }),
    [timelineEntries, isWorking, activeTurnStartedAt, turnDiffSummaryByAssistantMessageId],
  )
  const rows = useStableRows(rawRows)

  const handleScroll = useCallback(() => {
    const state = listRef.current?.getState?.()
    const isAtEnd = resolveTimelineIsAtEnd(state)
    if (isAtEnd !== undefined) {
      onIsAtEndChange?.(isAtEnd)
    }
  }, [listRef, onIsAtEndChange])

  useEffect(() => {
    const frame = requestAnimationFrame(handleScroll)
    return () => cancelAnimationFrame(frame)
  }, [handleScroll, rows.length])

  const renderItem = useCallback(
    ({ item }: { item: MessagesTimelineRow }) => (
      <div className="mx-auto w-full min-w-0 max-w-3xl overflow-x-clip" data-timeline-root="true">
        <TimelineRowContent
          row={item}
          theme={theme}
          expandAll={expandAll}
          onToggleAllDirectories={onToggleAllDirectories}
          onResolvePermission={onResolvePermission}
        />
      </div>
    ),
    [expandAll, onResolvePermission, onToggleAllDirectories, theme],
  )

  if (rows.length === 0 && !isWorking) {
    return (
      <div
        data-messages-timeline="true"
        className="flex h-full items-center justify-center"
      >
        <p className="text-sm text-muted-foreground/30">
          Send a message to start the conversation.
        </p>
      </div>
    )
  }

  return (
    <div data-messages-timeline="true" className="relative h-full min-h-0">
      <LegendList<MessagesTimelineRow>
        ref={listRef}
        data={rows}
        keyExtractor={item => item.id}
        getItemType={item =>
          item.kind === "message" ? `message:${item.message.role}` : item.kind
        }
        renderItem={renderItem}
        estimatedItemSize={90}
        initialScrollAtEnd
        contentInsetEndAdjustment={contentInsetEndAdjustment}
        maintainScrollAtEnd={{
          animated: false,
          on: {
            dataChange: true,
            itemLayout: true,
            layout: true,
          },
        }}
        maintainVisibleContentPosition={{
          data: true,
          size: false,
        }}
        onScroll={handleScroll}
        className="scrollbar-gutter-both h-full min-h-0 overflow-x-hidden overscroll-y-contain px-3 [overflow-anchor:none] sm:px-5"
        ListHeaderComponent={TIMELINE_LIST_HEADER}
        ListFooterComponent={TIMELINE_LIST_FOOTER}
      />
    </div>
  )
})
