import type {
  AgentCatalogState,
  AgentThread,
  ResolveAgentPermissionInput,
  ResolveAgentUserInputInput,
} from "@gharargah/agents"
import {
  buildTurnDiffSummaryByAssistantMessageId,
  deriveComposerCapabilities,
  deriveTimelineEntriesFromThread,
} from "@gharargah/agents"
import { AlertCircle, ChevronDown, Monitor, X } from "lucide-react"
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from "react"
import { ChatComposer } from "./composer/ChatComposer.js"
import type {
  ComposerInteractionMode,
  ComposerRuntimeMode,
} from "./composer/ComposerModeControls.js"
import { interactionModeFromSessionModeId } from "./composer/ComposerModeControls.js"
import {
  deriveProviderInstanceEntries,
  agentCatalogToProviderState,
  resolveDefaultProviderSelection,
} from "./providerInstances.js"
import { ChatHeader } from "./timeline/ChatHeader.js"
import { MessagesTimeline } from "./timeline/MessagesTimeline.js"
import { deriveTimelineTurnFromThread } from "./timeline/MessagesTimeline.logic.js"
import { ConnectionBanner } from "./timeline/ConnectionBanner.js"
import type { TimelineScrollMode } from "./timeline/timelineScrollAnchoring.js"

import type { ProviderDriverKind } from "@gharargah/agents"
import { Button } from "../components/ui/button.js"

export const AgentChatView = memo(function AgentChatView(props: {
  thread: AgentThread | null
  agents: AgentCatalogState | null
  theme: "light" | "dark"
  onSend: (payload: {
    text: string
    agentId: string | null
    driverId: string | null
    model: string | null
    images?: ReadonlyArray<{ data: string; mimeType: string; name?: string }>
    files?: ReadonlyArray<{
      name: string
      mimeType?: string
      path?: string
      data?: string
    }>
  }) => Promise<void>
  onInterrupt?: () => Promise<void> | void
  onSelectionChange?: (instanceId: string, model: string) => void
  onAgentsRefresh?: (providerId?: string) => void
  onResolvePermission?: (input: Omit<ResolveAgentPermissionInput, "workspaceRootUri" | "workspaceRootPath" | "threadId">) => Promise<void> | void
  onResolveUserInput?: (
    input: Omit<ResolveAgentUserInputInput, "workspaceRootUri" | "workspaceRootPath" | "threadId">,
  ) => Promise<void> | void
  onConfigOptionChange?: (input: { configId: string; value: string }) => Promise<void> | void
  onAuthenticate?: (methodId: string) => Promise<void> | void
  onRuntimeModeChange?: (mode: ComposerRuntimeMode) => void
  onInteractionModeChange?: (mode: ComposerInteractionMode) => void
  /** Hide the in-pane header when session chrome owns it. */
  hideHeader?: boolean
  /** Show Cursor-style terminal chip above composer. */
  terminalCount?: number
  onOpenTerminal?: () => void
  onOpenFile?: (ref: import("@gharargah/agents").AgentFileReference) => void
  onOpenDiff?: (ref: import("@gharargah/agents").AgentFileReference) => void
}) {
  const {
    thread,
    agents,
    theme,
    onSend,
    onInterrupt,
    onSelectionChange,
    onAgentsRefresh,
    onResolvePermission,
    onResolveUserInput,
    onConfigOptionChange,
    onAuthenticate,
    onRuntimeModeChange,
    onInteractionModeChange,
    hideHeader = false,
    terminalCount = 1,
    onOpenTerminal,
    onOpenFile,
    onOpenDiff,
  } = props
  const [submitting, setSubmitting] = useState(false)
  const [expandAll, setExpandAll] = useState(true)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [composerOverlayHeight, setComposerOverlayHeight] = useState(120)
  const [actionError, setActionError] = useState<string | null>(null)
  const [dismissedErrorKey, setDismissedErrorKey] = useState<string | null>(null)
  const [respondingPermissionId, setRespondingPermissionId] = useState<string | null>(null)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [droppedFileBatch, setDroppedFileBatch] = useState<{
    id: number
    files: File[]
  } | null>(null)
  const composerOverlayRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<import("@legendapp/list/react").LegendListRef | null>(null)
  const timelineScrollModeRef = useRef<TimelineScrollMode>("following-end")
  const userScrollGenerationRef = useRef(0)
  const liveFollowGenerationRef = useRef(0)
  const timelineEntriesLengthRef = useRef(0)
  const isAtEndRef = useRef(true)
  const showScrollToBottomRef = useRef(showScrollToBottom)
  const showScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  showScrollToBottomRef.current = showScrollToBottom

  const providers = useMemo(() => {
    const state = agentCatalogToProviderState(agents)
    if (!state || !agents) return state
    // Agent chat uses structured transports (ACP or native); hide terminal-only CLI entries.
    const structuredAgents = new Set(
      agents.agents
        .filter(agent => agent.drivers.some(driver => driver.kind !== "cli"))
        .map(agent => agent.id),
    )
    return {
      ...state,
      providers: state.providers
        .filter(provider => structuredAgents.has(provider.instanceId))
        .map(provider =>
          provider.instanceId === thread?.agentId && thread.discoveredModels?.length
            ? { ...provider, models: thread.discoveredModels }
            : provider,
        ),
    }
  }, [agents, thread?.agentId, thread?.discoveredModels])
  const instanceEntries = useMemo(() => deriveProviderInstanceEntries(providers), [providers])
  const defaultSelection = useMemo(
    () => resolveDefaultProviderSelection(instanceEntries, thread?.agentId, thread?.model),
    [instanceEntries, thread?.agentId, thread?.model],
  )

  const timelineEntries = useMemo(
    () => (thread ? deriveTimelineEntriesFromThread(thread) : []),
    [thread],
  )
  const shellEnvLoading = agents?.shellEnvStatus === "loading"
  // `agents == null` is initial fetch — treat as loading for the switcher only.
  const shellEnvPending = shellEnvLoading || agents == null
  timelineEntriesLengthRef.current = timelineEntries.length
  const turnDiffSummaryByAssistantMessageId = useMemo(
    () => (thread ? buildTurnDiffSummaryByAssistantMessageId(thread) : new Map()),
    [thread],
  )
  const { latestTurn, runningTurnId } = useMemo(
    () => (thread ? deriveTimelineTurnFromThread(thread) : { latestTurn: null, runningTurnId: null }),
    [thread],
  )

  const isWorking = ["connecting", "authenticating", "running", "waiting_for_permission", "cancelling", "reconnecting"].includes(thread?.status ?? "") || submitting

  const nonModelConfigOptions = useMemo(
    () =>
      (thread?.configOptions ?? []).filter(
        option => option.category?.toLowerCase() !== "model" && option.id !== "model",
      ),
    [thread?.configOptions],
  )

  useLayoutEffect(() => {
    const node = composerOverlayRef.current
    if (!node) return
    const updateHeight = () => {
      const height = node.getBoundingClientRect().height
      if (height > 0) setComposerOverlayHeight(height)
    }
    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(node)
    return () => observer.disconnect()
  }, [thread?.id])

  const cancelTimelineLiveFollowForUserNavigation = useCallback(() => {
    userScrollGenerationRef.current += 1
    timelineScrollModeRef.current = "free-scrolling"
    liveFollowGenerationRef.current = -1
  }, [])

  const cancelShowScrollToBottom = useCallback(() => {
    if (showScrollTimeoutRef.current) {
      clearTimeout(showScrollTimeoutRef.current)
      showScrollTimeoutRef.current = null
    }
  }, [])

  const scheduleShowScrollToBottom = useCallback(() => {
    cancelShowScrollToBottom()
    showScrollTimeoutRef.current = setTimeout(() => {
      showScrollTimeoutRef.current = null
      setShowScrollToBottom(true)
    }, 150)
  }, [cancelShowScrollToBottom])

  const scrollToEnd = useCallback((animated = true) => {
    timelineScrollModeRef.current = "following-end"
    liveFollowGenerationRef.current = userScrollGenerationRef.current
    cancelShowScrollToBottom()
    setShowScrollToBottom(false)
    const list = listRef.current
    if (!list) return
    if (typeof list.scrollToEnd === "function") {
      void list.scrollToEnd({ animated })
      return
    }
    void list.scrollToIndex({
      index: Math.max(0, timelineEntriesLengthRef.current - 1),
      animated,
    })
  }, [cancelShowScrollToBottom])

  const onIsAtEndChange = useCallback(
    (isAtEnd: boolean) => {
      if (
        !isAtEnd &&
        liveFollowGenerationRef.current === userScrollGenerationRef.current &&
        timelineScrollModeRef.current !== "free-scrolling"
      ) {
        cancelShowScrollToBottom()
        return
      }
      if (isAtEndRef.current === isAtEnd) return
      isAtEndRef.current = isAtEnd
      if (isAtEnd) {
        timelineScrollModeRef.current = "following-end"
        liveFollowGenerationRef.current = userScrollGenerationRef.current
        cancelShowScrollToBottom()
        setShowScrollToBottom(false)
        return
      }
      if (timelineScrollModeRef.current === "free-scrolling" && showScrollToBottomRef.current) {
        return
      }
      timelineScrollModeRef.current = "free-scrolling"
      liveFollowGenerationRef.current = -1
      scheduleShowScrollToBottom()
    },
    [cancelShowScrollToBottom, scheduleShowScrollToBottom],
  )

  useEffect(() => {
    let disposed = false
    let cleanup: (() => void) | undefined
    const frame = requestAnimationFrame(() => {
      if (disposed) return
      const list = listRef.current
      const scrollNode =
        (list?.getScrollableNode?.() as HTMLElement | null | undefined) ??
        (list?.getNativeScrollRef?.() as HTMLElement | null | undefined) ??
        null
      if (!scrollNode || typeof scrollNode.addEventListener !== "function") return

      const handleManualNavigation = () => {
        cancelTimelineLiveFollowForUserNavigation()
      }
      scrollNode.addEventListener("wheel", handleManualNavigation, { passive: true })
      scrollNode.addEventListener("touchmove", handleManualNavigation, { passive: true })
      cleanup = () => {
        scrollNode.removeEventListener("wheel", handleManualNavigation)
        scrollNode.removeEventListener("touchmove", handleManualNavigation)
      }
    })
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      cleanup?.()
    }
  }, [cancelTimelineLiveFollowForUserNavigation, thread?.id, timelineEntries.length])

  useEffect(() => {
    if (!thread?.id) return
    if (liveFollowGenerationRef.current !== userScrollGenerationRef.current) return
    if (timelineScrollModeRef.current === "free-scrolling") return
    if (
      timelineScrollModeRef.current !== "following-end" &&
      timelineScrollModeRef.current !== "anchoring-new-turn"
    ) {
      return
    }
    const frame = requestAnimationFrame(() => {
      if (liveFollowGenerationRef.current !== userScrollGenerationRef.current) return
      if (timelineScrollModeRef.current === "free-scrolling") return
      scrollToEnd(false)
      if (timelineScrollModeRef.current === "anchoring-new-turn") {
        timelineScrollModeRef.current = "following-end"
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [scrollToEnd, thread?.id, thread?.messages.length, thread?.updatedAt, timelineEntries.length])

  useEffect(() => {
    timelineScrollModeRef.current = "following-end"
    liveFollowGenerationRef.current = userScrollGenerationRef.current
    isAtEndRef.current = true
    cancelShowScrollToBottom()
    setShowScrollToBottom(false)
    setActionError(null)
    setDismissedErrorKey(null)
    setRespondingPermissionId(null)
  }, [cancelShowScrollToBottom, thread?.id])

  useEffect(() => () => cancelShowScrollToBottom(), [cancelShowScrollToBottom])

  async function handleSend(payload: {
    text: string
    instanceId: string
    model: string
    images?: ReadonlyArray<{ data: string; mimeType: string; name?: string }>
    files?: ReadonlyArray<{
      name: string
      mimeType?: string
      path?: string
      data?: string
    }>
  }) {
    if (submitting || !thread) return
    const fallbackDriverId = thread.driverId
    setSubmitting(true)
    timelineScrollModeRef.current = "anchoring-new-turn"
    liveFollowGenerationRef.current = userScrollGenerationRef.current
    try {
      await onSend({
        text: payload.text,
        agentId: payload.instanceId,
        driverId:
          agents?.agents.find(agent => agent.id === payload.instanceId)?.activeDriverId ??
          fallbackDriverId ??
          null,
        model: payload.model,
        ...(payload.images?.length ? { images: payload.images } : {}),
        ...(payload.files?.length ? { files: payload.files } : {}),
      })
    } finally {
      setSubmitting(false)
      scrollToEnd(true)
    }
  }

  if (!thread) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select an agent to view its conversation.
      </div>
    )
  }

  const projectName = thread.workspaceRootPath.split("/").filter(Boolean).at(-1) ?? thread.workspaceRootPath
  const selectedModelSlug = defaultSelection?.model ?? thread.model
  const modelLabel = (() => {
    if (!selectedModelSlug) return null
    const models =
      agents?.agents.find(agent => agent.id === (defaultSelection?.instanceId ?? thread.agentId))
        ?.models ?? []
    const match = models.find(model => model.slug === selectedModelSlug)
    return match?.shortName ?? match?.name ?? selectedModelSlug
  })()
  const activityLabel =
    thread.activity?.trim() ||
    (thread.status === "running" && thread.connection?.status !== "error"
      ? "Agent is running…"
      : null)

  const lockedProvider: ProviderDriverKind | null =
    thread.acpProvider || (thread.timeline?.length ?? 0) > 0 || (thread.messages?.length ?? 0) > 1
      ? ((thread.agentId ?? null) as ProviderDriverKind | null)
      : null
  const lockedContinuationGroupKey = thread.agentId
    ? `${thread.agentId}:instance:${thread.agentId}`
    : null

  const showPlanFollowUpPrompt =
    Boolean(thread.plan?.entries?.length) ||
    timelineEntries.some(entry => entry.kind === "proposed-plan") ||
    (thread.timeline ?? []).some(item => item.kind === "plan")

  const isEmptyThread =
    timelineEntries.length === 0 &&
    (thread.messages?.length ?? 0) === 0 &&
    !isWorking
  const pendingActionCount =
    (thread.pendingPermissions?.length ?? 0) + (thread.pendingUserInputs?.length ?? 0)

  const selectedAgent =
    agents?.agents.find(agent => agent.id === (defaultSelection?.instanceId ?? thread.agentId)) ??
    agents?.agents.find(agent => agent.id === "cursor") ??
    null
  const composerCapabilities = deriveComposerCapabilities({
    thread,
    agent: selectedAgent,
  })

  const runtimeMode: ComposerRuntimeMode =
    thread.runtimeMode === "auto-accept-edits" || thread.runtimeMode === "full-access"
      ? thread.runtimeMode
      : "approval-required"
  const interactionMode: ComposerInteractionMode =
    thread.interactionMode === "plan" ||
    thread.interactionMode === "ask" ||
    thread.interactionMode === "implement"
      ? thread.interactionMode
      : (interactionModeFromSessionModeId(thread.sessionModes?.currentModeId) ?? "implement")

  const handleAgentFileDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return
    event.preventDefault()
    event.stopPropagation()
    const files = Array.from(event.dataTransfer.files)
    setIsDraggingFiles(false)
    if (files.length > 0) {
      setDroppedFileBatch({ id: Date.now(), files })
    }
  }

  const handleResolvePermission = useCallback(
    async (
      input: Omit<ResolveAgentPermissionInput, "workspaceRootUri" | "workspaceRootPath" | "threadId">,
    ) => {
      setRespondingPermissionId(input.permissionId)
      setActionError(null)
      try {
        await onResolvePermission?.(input)
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error))
      } finally {
        setRespondingPermissionId(null)
      }
    },
    [onResolvePermission],
  )

  const handleResolveUserInput = useCallback(
    async (
      input: Omit<ResolveAgentUserInputInput, "workspaceRootUri" | "workspaceRootPath" | "threadId">,
    ) => {
      setActionError(null)
      try {
        await onResolveUserInput?.(input)
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error))
      }
    },
    [onResolveUserInput],
  )

  const handleInterrupt = useCallback(async () => {
    setActionError(null)
    try {
      await onInterrupt?.()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }, [onInterrupt])

  const bannerError =
    actionError ??
    (thread.lastError && dismissedErrorKey !== `${thread.id}:${thread.lastError}`
      ? thread.lastError
      : null)

  const pendingPermission = thread.pendingPermissions?.[0] ?? null

  return (
    <div
      className="relative flex h-full min-h-0 flex-col bg-background"
      data-chat-provider={defaultSelection?.instanceId ?? thread.agentId ?? "unknown"}
      data-chat-driver={thread.driverId ?? "unknown"}
      data-gharargah-agent-drop-zone="true"
      data-agent-file-drag-active={isDraggingFiles ? "true" : "false"}
      onDragEnter={event => {
        if (!event.dataTransfer.types.includes("Files")) return
        event.preventDefault()
        setIsDraggingFiles(true)
      }}
      onDragOver={event => {
        if (!event.dataTransfer.types.includes("Files")) return
        event.preventDefault()
        event.dataTransfer.dropEffect = "copy"
        setIsDraggingFiles(true)
      }}
      onDragLeave={event => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setIsDraggingFiles(false)
      }}
      onDrop={handleAgentFileDrop}
    >
      {hideHeader ? (
        <div
          className="flex shrink-0 items-center gap-2 px-4 pb-1 pt-3 sm:px-5"
          data-chat-slim-title=""
        >
          <p className="min-w-0 truncate text-xs text-agent-feed-muted">
            {thread.title?.trim() || "Agent"}
          </p>
          <Monitor className="size-3.5 shrink-0 text-agent-feed-muted/70" aria-hidden />
        </div>
      ) : (
        <ChatHeader
          activeThreadTitle={thread.title}
          activeProjectName={projectName}
          activeModelLabel={modelLabel}
          connection={thread.connection}
          usage={thread.usage}
        />
      )}
      <ConnectionBanner
        connection={thread.connection}
        onAuthenticate={onAuthenticate ? methodId => void onAuthenticate(methodId) : undefined}
      />

      {isDraggingFiles ? (
        <div
          className="pointer-events-none absolute inset-3 z-50 flex items-center justify-center rounded-xl border border-dashed border-primary/50 bg-background/85 text-sm font-medium text-foreground backdrop-blur-sm"
          role="status"
        >
          Drop files to attach
        </div>
      ) : null}

      {bannerError ? (
        <div
          className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-xs text-destructive"
          role="alert"
        >
          <AlertCircle className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{bannerError}</span>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className="shrink-0 text-destructive hover:text-destructive"
            aria-label="Dismiss error"
            onClick={() => {
              if (actionError) {
                setActionError(null)
                return
              }
              if (thread.lastError) {
                setDismissedErrorKey(`${thread.id}:${thread.lastError}`)
              }
            }}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1">
        <MessagesTimeline
          listRef={listRef}
          timelineEntries={timelineEntries}
          turnDiffSummaryByAssistantMessageId={turnDiffSummaryByAssistantMessageId}
          latestTurn={latestTurn}
          runningTurnId={runningTurnId}
          isWorking={isWorking}
          workingLabel={activityLabel ?? "Working…"}
          activeTurnStartedAt={latestTurn?.startedAt ?? null}
          theme={theme}
          contentInsetEndAdjustment={composerOverlayHeight}
          expandAll={expandAll}
          onToggleAllDirectories={() => setExpandAll(value => !value)}
          onOpenFile={onOpenFile}
          onOpenDiff={onOpenDiff}
          onIsAtEndChange={onIsAtEndChange}
          onResolveUserInput={handleResolveUserInput}
        />

        {showScrollToBottom ? (
          <div
            className="pointer-events-none absolute left-1/2 z-30 flex -translate-x-1/2 justify-center py-1.5"
            style={{ bottom: composerOverlayHeight + 4 }}
          >
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label="Scroll to end"
              title="Scroll to end"
              onClick={() => scrollToEnd(true)}
              className="pointer-events-auto rounded-full text-muted-foreground"
            >
              <ChevronDown className="size-3.5" />
              Scroll to end
            </Button>
          </div>
        ) : null}
      </div>

      <div
        ref={composerOverlayRef}
        data-chat-composer-overlay="true"
        data-chat-composer-empty={isEmptyThread ? "true" : "false"}
        className={
          isEmptyThread
            ? "pointer-events-none absolute inset-x-0 top-[42%] z-20 -translate-y-1/2 pt-1.5 sm:pt-2"
            : "pointer-events-none absolute inset-x-0 bottom-0 z-20 pt-1.5 sm:pt-2"
        }
      >
        <div
          aria-hidden="true"
          className="chat-composer-horizontal-inset pointer-events-none absolute inset-x-0 top-1.5 bottom-0 z-0 sm:top-2"
        >
          <div className="relative mx-auto h-full w-full max-w-3xl overflow-clip rounded-t-[20px]">
            <div className="chat-composer-shared-blur absolute -inset-8" />
          </div>
        </div>
        <div className="chat-composer-horizontal-inset pointer-events-auto relative z-10 isolate pb-4">
          {terminalCount > 0 && !isEmptyThread ? (
            <div className="mb-2 flex justify-start px-1">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-7 rounded-full border border-border/40 bg-muted/40 px-3 text-xs font-normal text-agent-feed-muted hover:text-agent-feed-primary"
                data-chat-terminal-pill=""
                onClick={() => onOpenTerminal?.()}
              >
                {terminalCount} Terminal{terminalCount === 1 ? "" : "s"}
              </Button>
            </div>
          ) : null}
          <ChatComposer
            providers={providers}
            instanceId={defaultSelection?.instanceId ?? thread.agentId}
            model={defaultSelection?.model ?? thread.model}
            // Only lock the switcher while login-shell PATH resolves.
            // After ready, keep it clickable even if no CLI is installed yet
            // (Tauri GUI PATH miss used to leave !defaultSelection → forever disabled).
            disabled={shellEnvPending}
            shellEnvLoading={shellEnvPending}
            isRunning={isWorking}
            isSendBusy={submitting}
            isRespondingPermission={
              pendingPermission ? respondingPermissionId === pendingPermission.id : false
            }
            commands={thread.availableCommands}
            runtimeMode={runtimeMode}
            interactionMode={interactionMode}
            availableInteractionModes={thread.sessionModes?.availableModes}
            configOptions={nonModelConfigOptions}
            capabilities={composerCapabilities}
            droppedFileBatch={droppedFileBatch}
            pendingPermission={pendingPermission}
            pendingUserInput={
              pendingPermission ? null : (thread.pendingUserInputs?.[0] ?? null)
            }
            pendingActionCount={pendingActionCount}
            onResolvePermission={input => void handleResolvePermission(input)}
            onResolveUserInput={input => void handleResolveUserInput(input)}
            onCancelTurn={() => void handleInterrupt()}
            onRuntimeModeChange={onRuntimeModeChange}
            onInteractionModeChange={onInteractionModeChange}
            onConfigOptionChange={
              onConfigOptionChange
                ? input => {
                    void onConfigOptionChange(input)
                  }
                : undefined
            }
            lockedProvider={lockedProvider}
            lockedContinuationGroupKey={lockedContinuationGroupKey}
            showPlanFollowUpPrompt={showPlanFollowUpPrompt}
            onImplementPlan={() => {
              if (!defaultSelection) return
              void handleSend({
                text: "Implement the plan.",
                instanceId: defaultSelection.instanceId,
                model: defaultSelection.model,
              })
            }}
            onInstanceModelChange={(instanceId, model) => onSelectionChange?.(instanceId, model)}
            onSend={handleSend}
            onInterrupt={() => void handleInterrupt()}
            onProvidersRefresh={onAgentsRefresh}
          />
        </div>
      </div>
    </div>
  )
})
