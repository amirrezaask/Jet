import type { AgentCatalogState, AgentThread } from "@gharargah/agents"
import {
  buildTurnDiffSummaryByAssistantMessageId,
  deriveTimelineEntriesFromThread,
} from "@gharargah/agents"
import { AlertCircle, ChevronDown, Loader2 } from "lucide-react"
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ChatComposer } from "./composer/ChatComposer.js"
import {
  deriveProviderInstanceEntries,
  agentCatalogToProviderState,
  resolveDefaultProviderSelection,
} from "./providerInstances.js"
import { ChatHeader } from "./timeline/ChatHeader.js"
import { MessagesTimeline } from "./timeline/MessagesTimeline.js"

export const AgentChatView = memo(function AgentChatView(props: {
  thread: AgentThread | null
  agents: AgentCatalogState | null
  theme: "light" | "dark"
  onSend: (payload: {
    text: string
    agentId: string | null
    driverId: string | null
    model: string | null
  }) => Promise<void>
  onInterrupt?: () => void
  onSelectionChange?: (instanceId: string, model: string) => void
  onAgentsRefresh?: () => void
}) {
  const { thread, agents, theme, onSend, onInterrupt, onSelectionChange, onAgentsRefresh } =
    props
  const [submitting, setSubmitting] = useState(false)
  const [expandAll, setExpandAll] = useState(true)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const [composerOverlayHeight, setComposerOverlayHeight] = useState(120)
  const composerOverlayRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<import("@legendapp/list/react").LegendListRef | null>(null)

  const providers = useMemo(() => agentCatalogToProviderState(agents), [agents])
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

  const isWorking = thread?.status === "running" || submitting

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

  async function handleSend(payload: { text: string; instanceId: string; model: string }) {
    if (submitting) return
    setSubmitting(true)
    try {
      await onSend({
        text: payload.text,
        agentId: payload.instanceId,
        driverId:
          agents?.agents.find(agent => agent.id === payload.instanceId)?.activeDriverId ?? null,
        model: payload.model,
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

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      <ChatHeader activeThreadTitle={thread.title} activeProjectName={projectName} />

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
          {thread.status === "running" ? (
            <div className="mb-2 flex items-center gap-2 px-1 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Agent is running…
            </div>
          ) : null}
          <ChatComposer
            providers={providers}
            instanceId={defaultSelection?.instanceId ?? thread.agentId}
            model={defaultSelection?.model ?? thread.model}
            disabled={thread.status === "running"}
            isRunning={thread.status === "running"}
            isSendBusy={submitting}
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
