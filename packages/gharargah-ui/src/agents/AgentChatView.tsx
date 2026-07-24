import type {
  AgentCatalogState,
  AgentThread,
  ResolveAgentPermissionInput,
  ResolveAgentUserInputInput,
} from "@gharargah/agents"
import {
  buildTurnDiffSummaryByAssistantMessageId,
  deriveTimelineEntriesFromThread,
} from "@gharargah/agents"
import { AlertCircle, ChevronDown, Loader2 } from "lucide-react"
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ChatComposer } from "./composer/ChatComposer.js"
import type {
  ComposerInteractionMode,
  ComposerRuntimeMode,
} from "./composer/ComposerModeControls.js"
import { AcpInspector } from "./inspector/AcpInspector.js"
import {
  deriveProviderInstanceEntries,
  agentCatalogToProviderState,
  resolveDefaultProviderSelection,
} from "./providerInstances.js"
import { ChatHeader } from "./timeline/ChatHeader.js"
import { MessagesTimeline } from "./timeline/MessagesTimeline.js"
import { ConnectionBanner } from "./timeline/ConnectionBanner.js"
import { PermissionCard } from "./timeline/PermissionCard.js"
import { UserInputCard } from "./timeline/UserInputCard.js"
import type { TimelineScrollMode } from "./timeline/timelineScrollAnchoring.js"

import type { ProviderDriverKind } from "./t3contracts.js"

export const AgentChatView = memo(function AgentChatView(props: {
  thread: AgentThread | null
  agents: AgentCatalogState | null
  theme: "light" | "dark"
  onSend: (payload: {
    text: string
    agentId: string | null
    driverId: string | null
    model: string | null
    images?: ReadonlyArray<{ data: string; mimeType: string }>
  }) => Promise<void>
  onInterrupt?: () => void
  onSelectionChange?: (instanceId: string, model: string) => void
  onAgentsRefresh?: () => void
  onResolvePermission?: (input: Omit<ResolveAgentPermissionInput, "workspaceRootUri" | "workspaceRootPath" | "threadId">) => Promise<void> | void
  onResolveUserInput?: (
    input: Omit<ResolveAgentUserInputInput, "workspaceRootUri" | "workspaceRootPath" | "threadId">,
  ) => Promise<void> | void
  onConfigOptionChange?: (input: { configId: string; value: string }) => Promise<void> | void
  onLoadAcpTrace?: () => Promise<unknown>
  onAuthenticate?: (methodId: string) => Promise<void> | void
  onForceStopProvider?: () => Promise<void> | void
  onRuntimeModeChange?: (mode: ComposerRuntimeMode) => void
  onInteractionModeChange?: (mode: ComposerInteractionMode) => void
  onListSessions?: () => Promise<unknown>
  onLogout?: () => Promise<void>
  onCloseSession?: () => Promise<void>
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
    onLoadAcpTrace,
    onAuthenticate,
    onForceStopProvider,
    onRuntimeModeChange,
    onInteractionModeChange,
    onListSessions,
    onLogout,
    onCloseSession,
  } = props
  const loadAcpTrace = useCallback(() => {
    if (onLoadAcpTrace) return onLoadAcpTrace()
    return Promise.resolve(null)
  }, [onLoadAcpTrace])
  const [submitting, setSubmitting] = useState(false)
  const [expandAll, setExpandAll] = useState(true)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [composerOverlayHeight, setComposerOverlayHeight] = useState(120)
  const [scrollFollowEnabled, setScrollFollowEnabled] = useState(true)
  const composerOverlayRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<import("@legendapp/list/react").LegendListRef | null>(null)
  const timelineScrollModeRef = useRef<TimelineScrollMode>("following-end")
  const userScrollGenerationRef = useRef(0)
  const liveFollowGenerationRef = useRef(0)
  const timelineEntriesLengthRef = useRef(0)

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
      providers: state.providers.filter(provider => structuredAgents.has(provider.instanceId)),
    }
  }, [agents])
  const instanceEntries = useMemo(() => deriveProviderInstanceEntries(providers), [providers])
  const defaultSelection = useMemo(
    () => resolveDefaultProviderSelection(instanceEntries, thread?.agentId, thread?.model),
    [instanceEntries, thread?.agentId, thread?.model],
  )

  const timelineEntries = useMemo(
    () => (thread ? deriveTimelineEntriesFromThread(thread) : []),
    [thread],
  )
  timelineEntriesLengthRef.current = timelineEntries.length
  const turnDiffSummaryByAssistantMessageId = useMemo(
    () => (thread ? buildTurnDiffSummaryByAssistantMessageId(thread) : new Map()),
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
    setScrollFollowEnabled(false)
  }, [])

  const scrollToEnd = useCallback((animated = true) => {
    timelineScrollModeRef.current = "following-end"
    liveFollowGenerationRef.current = userScrollGenerationRef.current
    setScrollFollowEnabled(true)
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
  }, [])

  const onIsAtEndChange = useCallback(
    (isAtEnd: boolean) => {
      if (
        !isAtEnd &&
        liveFollowGenerationRef.current === userScrollGenerationRef.current &&
        timelineScrollModeRef.current !== "free-scrolling"
      ) {
        // Transient not-at-end while live-following (content growth) — ignore.
        return
      }
      if (isAtEnd) {
        timelineScrollModeRef.current = "following-end"
        liveFollowGenerationRef.current = userScrollGenerationRef.current
        setScrollFollowEnabled(true)
        setShowScrollToBottom(false)
        return
      }
      timelineScrollModeRef.current = "free-scrolling"
      liveFollowGenerationRef.current = -1
      setScrollFollowEnabled(false)
      setShowScrollToBottom(true)
    },
    [],
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
      scrollNode.addEventListener("pointerdown", handleManualNavigation, { passive: true })
      cleanup = () => {
        scrollNode.removeEventListener("wheel", handleManualNavigation)
        scrollNode.removeEventListener("touchmove", handleManualNavigation)
        scrollNode.removeEventListener("pointerdown", handleManualNavigation)
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
    setScrollFollowEnabled(true)
    setShowScrollToBottom(false)
  }, [thread?.id])

  async function handleSend(payload: {
    text: string
    instanceId: string
    model: string
    images?: ReadonlyArray<{ data: string; mimeType: string }>
  }) {
    if (submitting || !thread) return
    const fallbackDriverId = thread.driverId
    setSubmitting(true)
    timelineScrollModeRef.current = "anchoring-new-turn"
    liveFollowGenerationRef.current = userScrollGenerationRef.current
    setScrollFollowEnabled(true)
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
    (thread.status === "running" ? "Agent is running…" : null)

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

  const runtimeMode: ComposerRuntimeMode =
    thread.runtimeMode === "auto-accept-edits" || thread.runtimeMode === "full-access"
      ? thread.runtimeMode
      : "approval-required"
  const interactionMode: ComposerInteractionMode =
    thread.interactionMode === "plan" || thread.interactionMode === "ask"
      ? thread.interactionMode
      : "implement"

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      <ChatHeader
        activeThreadTitle={thread.title}
        activeProjectName={projectName}
        activeModelLabel={modelLabel}
        connection={thread.connection}
        usage={thread.usage}
        inspector={
          <AcpInspector
            connection={thread.connection}
            onLoadTrace={loadAcpTrace}
            onForceStop={onForceStopProvider ? () => void onForceStopProvider() : undefined}
            onListSessions={onListSessions}
            onLogout={onLogout}
            onCloseSession={onCloseSession}
          />
        }
      />
      <ConnectionBanner
        connection={thread.connection}
        onAuthenticate={onAuthenticate ? methodId => void onAuthenticate(methodId) : undefined}
      />

      {thread.status === "error" && thread.lastError ? (
        <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-xs text-destructive">
          <AlertCircle className="size-3.5 shrink-0" />
          <span>{thread.lastError}</span>
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1">
        <MessagesTimeline
          listRef={listRef}
          timelineEntries={timelineEntries}
          turnDiffSummaryByAssistantMessageId={turnDiffSummaryByAssistantMessageId}
          isWorking={isWorking}
          theme={theme}
          contentInsetEndAdjustment={composerOverlayHeight}
          expandAll={expandAll}
          maintainScrollAtEndEnabled={scrollFollowEnabled}
          onToggleAllDirectories={() => setExpandAll(value => !value)}
          onIsAtEndChange={onIsAtEndChange}
          onResolvePermission={(permissionId, decision, optionId) =>
            void onResolvePermission?.({ permissionId, decision, optionId })
          }
          onResolveUserInput={input => void onResolveUserInput?.(input)}
        />

        {showScrollToBottom ? (
          <div
            className="pointer-events-none absolute left-1/2 z-30 flex -translate-x-1/2 justify-center py-1.5"
            style={{ bottom: composerOverlayHeight + 4 }}
          >
            <button
              type="button"
              aria-label="Scroll to end"
              title="Scroll to end"
              onClick={() => scrollToEnd(true)}
              className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1 text-muted-foreground text-xs shadow-sm transition-colors hover:border-border hover:text-foreground hover:cursor-pointer"
            >
              <ChevronDown className="size-3.5" />
              Scroll to end
            </button>
          </div>
        ) : null}
      </div>

      <div
        ref={composerOverlayRef}
        data-chat-composer-overlay="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-20 pt-1.5 sm:pt-2"
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
          {activityLabel ? (
            <div
              className="mb-2 flex items-center gap-2 px-1 text-xs text-muted-foreground"
              data-chat-activity="true"
              title={activityLabel}
            >
              <Loader2 className="size-3 shrink-0 animate-spin" />
              <span className="min-w-0 truncate">{activityLabel}</span>
            </div>
          ) : null}
          {thread.pendingPermissions?.length ? (
            <div className="mb-2 space-y-2">
              {thread.pendingPermissions.map(permission => (
                <PermissionCard
                  key={permission.id}
                  permission={permission}
                  disabled={!onResolvePermission}
                  onResolve={input => void onResolvePermission?.(input)}
                />
              ))}
            </div>
          ) : null}
          {thread.pendingUserInputs?.length ? (
            <div className="mb-2 space-y-2">
              {thread.pendingUserInputs.map(userInput => (
                <UserInputCard
                  key={userInput.id}
                  userInput={userInput}
                  disabled={!onResolveUserInput}
                  onResolve={input => void onResolveUserInput?.(input)}
                />
              ))}
            </div>
          ) : null}
          <ChatComposer
            providers={providers}
            instanceId={defaultSelection?.instanceId ?? thread.agentId}
            model={defaultSelection?.model ?? thread.model}
            disabled={isWorking}
            isRunning={isWorking}
            isSendBusy={submitting}
            commands={thread.availableCommands}
            runtimeMode={runtimeMode}
            interactionMode={interactionMode}
            availableInteractionModes={thread.sessionModes?.availableModes}
            configOptions={nonModelConfigOptions}
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
            onInterrupt={() => onInterrupt?.()}
            onProvidersRefresh={onAgentsRefresh}
          />
        </div>
      </div>
    </div>
  )
})
