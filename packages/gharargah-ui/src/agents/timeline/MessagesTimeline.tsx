import type {
  AgentFileReference,
  AgentPermissionRequest,
  ResolveAgentUserInputInput,
  TimelineEntry,
  TurnDiffSummary,
} from "@gharargah/agents"
import { LegendList, type LegendListRef } from "@legendapp/list/react"
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { flushSync } from "react-dom"
import { AlertCircle, FileText, Image as ImageIcon } from "lucide-react"
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "../../components/ui/attachment.js"
import { cn } from "../../lib/utils.js"
import { Spinner } from "../../components/ui/spinner.js"
import { AgentMarkdown } from "../AgentMarkdown.js"
import { AgentPatchView } from "../AgentPatchView.js"
import { ChangedFilesCard } from "../ChangedFilesTree.js"
import { DiffStatLabel, hasNonZeroStat } from "../DiffStatLabel.js"
import { MessageCopyButton } from "./MessageCopyButton.js"
import { ThoughtBlock } from "./ThoughtBlock.js"
import { ToolCallCard } from "./ToolCallCard.js"
import { UserInputCard } from "./UserInputCard.js"
import { PlanCard } from "./PlanCard.js"
import { UsageMeter } from "./UsageMeter.js"
import {
  computeStableMessagesTimelineRows,
  deriveMessagesTimelineRows,
  formatTimelineTimestamp,
  coerceMessageText,
  resolveAssistantMessageCopyState,
  resolveTimelineIsAtEnd,
  type MessagesTimelineRow,
  type StableMessagesTimelineRowsState,
  type TimelineLatestTurn,
} from "./MessagesTimeline.logic.js"

const TIMELINE_LIST_HEADER = <div className="h-3 sm:h-4" />
const TIMELINE_LIST_FOOTER = <div className="h-3 sm:h-4" />

const EMPTY_STABLE_ROWS: StableMessagesTimelineRowsState = {
  byId: new Map(),
  result: [],
}

type TimelineRowCallbackContextValue = {
  onToggleAllDirectories: () => void
  onOpenFile?: (ref: AgentFileReference) => void
  onOpenDiff?: (ref: AgentFileReference) => void
  onResolveUserInput?: (
    input: Omit<ResolveAgentUserInputInput, "workspaceRootUri" | "workspaceRootPath" | "threadId">,
  ) => void
}

type TimelineRowDisplayContextValue = {
  theme: "light" | "dark"
  expandAll: boolean
  listRef: React.RefObject<LegendListRef | null>
}

const TimelineRowCallbackCtx = createContext<TimelineRowCallbackContextValue | null>(null)
const TimelineRowDisplayCtx = createContext<TimelineRowDisplayContextValue | null>(null)

function useTimelineRowCallbacks(): TimelineRowCallbackContextValue {
  const value = useContext(TimelineRowCallbackCtx)
  if (!value) {
    throw new Error("TimelineRowCallbackCtx is missing")
  }
  return value
}

function useTimelineRowDisplay(): TimelineRowDisplayContextValue {
  const value = useContext(TimelineRowDisplayCtx)
  if (!value) {
    throw new Error("TimelineRowDisplayCtx is missing")
  }
  return value
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

const UserTimelineRow = memo(function UserTimelineRow(props: {
  row: Extract<MessagesTimelineRow, { kind: "message" }>
}) {
  const { row } = props
  const messageText = coerceMessageText(row.message.text)
  const copyText = messageText.trim()
  return (
    <div className="group flex flex-col items-start gap-1.5" data-chat-user-bubble="">
      <div className="relative max-w-[85%] rounded-[1.25rem] bg-agent-user-bubble px-4 py-2.5">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-agent-feed-primary">
          {messageText}
        </p>
        {row.message.attachments?.length ? (
          <AttachmentGroup className="mt-2">
            {row.message.attachments.map((attachment, index) => (
              <Attachment
                key={`${attachment.kind}-${attachment.path ?? attachment.name}-${index}`}
                size="xs"
                data-message-attachment={attachment.kind}
              >
                <AttachmentMedia>
                  {attachment.kind === "image" ? (
                    <ImageIcon aria-hidden="true" />
                  ) : (
                    <FileText aria-hidden="true" />
                  )}
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle>{attachment.name}</AttachmentTitle>
                  <AttachmentDescription>
                    {attachment.kind === "image" ? "Image" : "File"}
                  </AttachmentDescription>
                </AttachmentContent>
              </Attachment>
            ))}
          </AttachmentGroup>
        ) : null}
      </div>
      <div className="flex w-full max-w-[85%] items-center justify-start pe-1 text-xs tabular-nums opacity-0 transition-opacity duration-[var(--gharargah-motion-menu)] focus-within:opacity-100 group-hover:opacity-100">
        <div className="flex shrink-0 items-center gap-2">
          <p className="text-agent-feed-muted text-xs tabular-nums">
            {formatTimelineTimestamp(row.message.createdAt)}
          </p>
          {copyText ? <MessageCopyButton text={copyText} variant="ghost" /> : null}
        </div>
      </div>
    </div>
  )
})

const TurnStatusTimelineRow = memo(function TurnStatusTimelineRow(props: {
  row: Extract<MessagesTimelineRow, { kind: "turn_status" }>
}) {
  return (
    <p
      className={cn(
        "py-1 text-sm font-medium",
        props.row.status === "completed" ? "text-agent-feed-muted" : "text-destructive",
      )}
      data-chat-turn-status={props.row.status}
    >
      {props.row.label}
    </p>
  )
})

const ActivityGroupTimelineRow = memo(function ActivityGroupTimelineRow(props: {
  row: Extract<MessagesTimelineRow, { kind: "activity_group" }>
}) {
  const { row } = props
  const { expandAll, listRef } = useTimelineRowDisplay()
  const { onToggleAllDirectories, onOpenFile, onOpenDiff } = useTimelineRowCallbacks()
  const [open, setOpen] = useState(false)
  const canExpand = row.toolCalls.length > 0 || row.changedFiles.length > 0
  const expandedRegionId = `activity-group-${row.id}`

  const toggleOpen = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (!canExpand) return
      const anchorBottomBeforeToggle = event.currentTarget.getBoundingClientRect().bottom

      flushSync(() => {
        setOpen(value => !value)
      })

      const delta = event.currentTarget.getBoundingClientRect().bottom - anchorBottomBeforeToggle
      if (Math.abs(delta) < 0.5) return

      const list = listRef.current
      const currentScroll = list?.getState?.().scroll
      if (list && typeof currentScroll === "number") {
        list.scrollToOffset({ offset: currentScroll + delta, animated: false })
      }
    },
    [canExpand, listRef],
  )

  return (
    <div className="py-0.5" data-chat-activity-group="" data-chat-activity-label={row.label}>
      <button
        type="button"
        className={cn(
          "flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 text-left text-sm text-agent-feed-muted",
          canExpand && "hover:text-agent-feed-primary",
        )}
        disabled={!canExpand}
        aria-expanded={canExpand ? open : undefined}
        aria-controls={canExpand ? expandedRegionId : undefined}
        onClick={toggleOpen}
      >
        {row.hasFailure ? (
          <AlertCircle className="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
        ) : null}
        <span>{row.label}</span>
        {row.diffStat && hasNonZeroStat(row.diffStat) ? (
          <DiffStatLabel
            additions={row.diffStat.additions}
            deletions={row.diffStat.deletions}
            layout="inline"
            className="text-xs"
          />
        ) : null}
      </button>
      {open && canExpand ? (
        <div
          id={expandedRegionId}
          role="region"
          aria-label="Activity details"
          className="mt-2 space-y-2 border-s border-border/40 ps-3"
        >
          {row.changedFiles.length > 0 ? (
            <ChangedFilesCard
              files={row.changedFiles}
              allDirectoriesExpanded={expandAll}
              onToggleAllDirectories={onToggleAllDirectories}
              onOpenFile={onOpenFile}
              onOpenDiff={onOpenDiff}
            />
          ) : null}
          {row.toolCalls.map(toolCall => (
            <ToolCallCard
              key={toolCall.id}
              toolCall={toolCall}
              flat
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
})

const AssistantTimelineRow = memo(function AssistantTimelineRow(props: {
  row: Extract<MessagesTimelineRow, { kind: "message" }>
}) {
  const { row } = props
  const { theme } = useTimelineRowDisplay()
  const { onOpenFile } = useTimelineRowCallbacks()
  const rawText = coerceMessageText(row.message.text)
  const messageText = rawText || (row.message.streaming ? "" : "(empty response)")
  const assistantCopyState = resolveAssistantMessageCopyState({
    text: rawText || null,
    showCopyButton: row.showAssistantCopyButton,
    streaming: row.assistantCopyStreaming,
  })

  return (
    <div className="relative min-w-0 px-0.5 py-0.5">
      <div className="prose-agent text-sm leading-relaxed text-agent-feed-primary">
        <AgentMarkdown text={messageText} theme={theme} onOpenFile={onOpenFile} />
      </div>
      {row.message.diffPatch ? (
        <div className="mt-3 overflow-hidden rounded-xl border border-border/50 bg-muted/20">
          <AgentPatchView patch={row.message.diffPatch} theme={theme} />
        </div>
      ) : null}
      {row.showAssistantMeta ? (
        <div className="mt-1.5 flex items-center gap-2 text-xs tabular-nums opacity-0 transition-opacity duration-[var(--gharargah-motion-menu)] focus-within:opacity-100 group-hover/assistant:opacity-100">
          {assistantCopyState.visible ? (
            <MessageCopyButton text={assistantCopyState.text ?? ""} variant="ghost" />
          ) : null}
          {!row.message.streaming ? (
            <p className="text-agent-feed-muted text-xs tabular-nums">
              {formatTimelineTimestamp(row.message.updatedAt)}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
})

const WorkingTimelineRow = memo(function WorkingTimelineRow(props: {
  row: Extract<MessagesTimelineRow, { kind: "working" }>
}) {
  return (
    <div className="py-1 pl-0.5">
      <div
        className="flex items-center gap-2 text-sm text-agent-feed-muted tabular-nums"
        data-chat-activity="true"
        role="status"
        title={props.row.label}
      >
        <Spinner className="size-3 opacity-60" aria-hidden="true" />
        <span className="min-w-0 truncate">{props.row.label}</span>
      </div>
    </div>
  )
})

/**
 * The timeline only records approvals; the live decision lives in the composer,
 * so a still-pending request reads as awaiting rather than settled.
 */
function permissionSummaryLabel(permission: AgentPermissionRequest): string {
  switch (permission.status) {
    case "cancelled":
    case "rejected":
      return "Declined"
    case "resolved":
      return "Approved"
    case "submitting":
      return "Deciding…"
    default:
      return "Awaiting approval"
  }
}

const StructuredTimelineRow = memo(function StructuredTimelineRow(props: {
  row: Extract<MessagesTimelineRow, { kind: "structured" }>
}) {
  const { onOpenFile, onResolveUserInput } = useTimelineRowCallbacks()
  const { item } = props.row
  if (item.kind === "thought") return <ThoughtBlock text={item.text} />
  if (item.kind === "tool_call") {
    return <ToolCallCard toolCall={item.toolCall} onOpenFile={onOpenFile} />
  }
  if (item.kind === "terminal") {
    return (
      <pre
        data-timeline-terminal="true"
        className="overflow-x-auto rounded-md bg-muted/25 px-2 py-1.5 font-mono text-xs text-agent-feed-muted"
      >
        {item.text}
      </pre>
    )
  }
  if (item.kind === "permission") {
    return (
      <p
        className="text-xs text-muted-foreground"
        data-timeline-permission-summary=""
      >
        {item.permission.title} — {permissionSummaryLabel(item.permission)}
      </p>
    )
  }
  if (item.kind === "plan") return <PlanCard plan={item.plan} />
  if (item.kind === "usage") return <UsageMeter usage={item.usage} />
  if (item.kind === "user_input") {
    return (
      <UserInputCard
        userInput={item.userInput}
        onResolve={input => onResolveUserInput?.(input)}
      />
    )
  }
  return (
    <p
      className={
        item.kind === "error" ? "text-xs text-destructive" : "text-xs text-muted-foreground"
      }
    >
      {item.text}
    </p>
  )
})

const TimelineRowContent = memo(function TimelineRowContent(props: { row: MessagesTimelineRow }) {
  const { row } = props
  return (
    <div
      className={cn(
        row.kind === "message" && row.message.role === "assistant" && !row.showAssistantMeta
          ? "pb-2"
          : "pb-3",
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
        <AssistantTimelineRow row={row} />
      ) : null}
      {row.kind === "turn_status" ? <TurnStatusTimelineRow row={row} /> : null}
      {row.kind === "activity_group" ? <ActivityGroupTimelineRow row={row} /> : null}
      {row.kind === "working" ? <WorkingTimelineRow row={row} /> : null}
      {row.kind === "structured" ? <StructuredTimelineRow row={row} /> : null}
    </div>
  )
})

export const MessagesTimeline = memo(function MessagesTimeline(props: {
  listRef?: React.RefObject<LegendListRef | null>
  timelineEntries: ReadonlyArray<TimelineEntry>
  turnDiffSummaryByAssistantMessageId: ReadonlyMap<string, TurnDiffSummary>
  latestTurn?: TimelineLatestTurn | null
  runningTurnId?: string | null
  isWorking: boolean
  workingLabel: string
  activeTurnStartedAt?: string | null
  theme: "light" | "dark"
  contentInsetEndAdjustment: number
  expandAll: boolean
  onToggleAllDirectories: () => void
  onOpenFile?: (ref: AgentFileReference) => void
  onOpenDiff?: (ref: AgentFileReference) => void
  onIsAtEndChange?: (isAtEnd: boolean) => void
  onResolveUserInput?: (
    input: Omit<ResolveAgentUserInputInput, "workspaceRootUri" | "workspaceRootPath" | "threadId">,
  ) => void
}) {
  const {
    listRef: externalListRef,
    timelineEntries,
    turnDiffSummaryByAssistantMessageId,
    latestTurn = null,
    runningTurnId = null,
    isWorking,
    workingLabel,
    activeTurnStartedAt = null,
    theme,
    contentInsetEndAdjustment,
    expandAll,
    onToggleAllDirectories,
    onOpenFile,
    onOpenDiff,
    onIsAtEndChange,
    onResolveUserInput,
  } = props

  const internalListRef = useRef<LegendListRef | null>(null)
  const listRef = externalListRef ?? internalListRef

  const rawRows = useMemo(
    () =>
      deriveMessagesTimelineRows({
        timelineEntries,
        latestTurn,
        runningTurnId,
        isWorking,
        workingLabel,
        activeTurnStartedAt,
        turnDiffSummaryByAssistantMessageId,
      }),
    [
      timelineEntries,
      latestTurn,
      runningTurnId,
      isWorking,
      workingLabel,
      activeTurnStartedAt,
      turnDiffSummaryByAssistantMessageId,
    ],
  )
  const rows = useStableRows(rawRows)

  const callbackSourceRef = useRef({
    onToggleAllDirectories,
    onOpenFile,
    onOpenDiff,
    onResolveUserInput,
  })
  callbackSourceRef.current = {
    onToggleAllDirectories,
    onOpenFile,
    onOpenDiff,
    onResolveUserInput,
  }

  const stableCallbacks = useMemo<TimelineRowCallbackContextValue>(
    () => ({
      onToggleAllDirectories: () => callbackSourceRef.current.onToggleAllDirectories(),
      onOpenFile: ref => callbackSourceRef.current.onOpenFile?.(ref),
      onOpenDiff: ref => callbackSourceRef.current.onOpenDiff?.(ref),
      onResolveUserInput: input => callbackSourceRef.current.onResolveUserInput?.(input),
    }),
    [],
  )

  const displayValue = useMemo<TimelineRowDisplayContextValue>(
    () => ({
      theme,
      expandAll,
      listRef,
    }),
    [theme, expandAll, listRef],
  )

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
        <TimelineRowContent row={item} />
      </div>
    ),
    [],
  )

  if (rows.length === 0 && !isWorking) {
    return (
      <div
        data-messages-timeline="true"
        className="flex h-full items-center justify-center"
      >
        <p className="text-sm text-muted-foreground/30">
          Describe the task you want the agent to handle.
        </p>
      </div>
    )
  }

  return (
    <TimelineRowCallbackCtx.Provider value={stableCallbacks}>
      <TimelineRowDisplayCtx.Provider value={displayValue}>
        <div data-messages-timeline="true" className="relative h-full min-h-0">
          <LegendList<MessagesTimelineRow>
            ref={listRef}
            data={rows}
            keyExtractor={item => item.id}
            getItemType={item => {
              if (item.kind === "message") return `message:${item.message.role}`
              if (item.kind === "structured") return `structured:${item.item.kind}`
              return item.kind
            }}
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
      </TimelineRowDisplayCtx.Provider>
    </TimelineRowCallbackCtx.Provider>
  )
})
