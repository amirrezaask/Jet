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
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ChatComposer } from "./composer/ChatComposer.js"
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
  onRuntimeModeChange?: (
    mode: "approval-required" | "auto-accept-edits" | "full-access",
  ) => void
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
  } = props
  const loadAcpTrace = useCallback(() => {
    if (onLoadAcpTrace) return onLoadAcpTrace()
    return Promise.resolve(null)
  }, [onLoadAcpTrace])
  const [submitting, setSubmitting] = useState(false)
  const [expandAll, setExpandAll] = useState(true)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [composerOverlayHeight, setComposerOverlayHeight] = useState(120)
  const composerOverlayRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<import("@legendapp/list/react").LegendListRef | null>(null)

  const providers = useMemo(() => {
    const state = agentCatalogToProviderState(agents)
    if (!state || !agents) return state
    // Agent chat is ACP-only; hide CLI-only catalog entries from the picker.
    const acpAgents = new Set(
      agents.agents
        .filter(agent => agent.drivers.some(driver => driver.kind === "acp"))
        .map(agent => agent.id),
    )
    return {
      ...state,
      providers: state.providers.filter(provider => acpAgents.has(provider.instanceId)),
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
  const turnDiffSummaryByAssistantMessageId = useMemo(
    () => (thread ? buildTurnDiffSummaryByAssistantMessageId(thread) : new Map()),
    [thread],
  )

  const isWorking = ["connecting", "authenticating", "running", "waiting_for_permission", "cancelling", "reconnecting"].includes(thread?.status ?? "") || submitting

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

  const nonModelConfigOptions = useMemo(
    () =>
      (thread?.configOptions ?? []).filter(
        option => option.category?.toLowerCase() !== "model" && option.id !== "model",
      ),
    [thread?.configOptions],
  )

  async function handleSend(payload: {
    text: string
    instanceId: string
    model: string
    images?: ReadonlyArray<{ data: string; mimeType: string }>
  }) {
    if (submitting || !thread) return
    const fallbackDriverId = thread.driverId
    setSubmitting(true)
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

  useLayoutEffect(() => {
    scrollToEnd(false)
  }, [thread?.messages.length, thread?.updatedAt, thread?.id])

  function scrollToEnd(animated = true) {
    void listRef.current?.scrollToIndex({
      index: Math.max(0, timelineEntries.length - 1),
      animated,
    })
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
          onToggleAllDirectories={() => setExpandAll(value => !value)}
          onIsAtEndChange={isAtEnd => setShowScrollToBottom(!isAtEnd)}
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
          {onRuntimeModeChange ? (
            <div className="mb-2 flex items-center gap-2 px-1 text-xs text-muted-foreground">
              <label htmlFor="agent-runtime-mode" className="shrink-0">
                Runtime
              </label>
              <select
                id="agent-runtime-mode"
                data-agent-runtime-mode="true"
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                value={thread.runtimeMode ?? "approval-required"}
                onChange={event =>
                  onRuntimeModeChange(
                    event.target.value as "approval-required" | "auto-accept-edits" | "full-access",
                  )
                }
              >
                <option value="approval-required">Approval required</option>
                <option value="auto-accept-edits">Auto-accept edits</option>
                <option value="full-access">Full access</option>
              </select>
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
          {nonModelConfigOptions.length > 0 ? (
            <div
              data-agent-config-options="true"
              className="mb-2 space-y-2 rounded-lg border border-border bg-card p-3"
            >
              {nonModelConfigOptions.map(option => (
                <div key={option.id} className="space-y-1">
                  <label
                    htmlFor={`agent-config-${option.id}`}
                    className="text-xs font-medium text-foreground"
                  >
                    {option.name}
                  </label>
                  {option.description ? (
                    <p className="text-3xs text-muted-foreground">{option.description}</p>
                  ) : null}
                  <select
                    id={`agent-config-${option.id}`}
                    className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                    value={option.currentValue ?? ""}
                    disabled={!onConfigOptionChange}
                    onChange={event =>
                      void onConfigOptionChange?.({
                        configId: option.id,
                        value: event.target.value,
                      })
                    }
                  >
                    {(option.values ?? []).map(value => (
                      <option key={value.value} value={value.value}>
                        {value.name}
                      </option>
                    ))}
                  </select>
                </div>
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
