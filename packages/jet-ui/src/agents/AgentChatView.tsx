import type { AgentProvidersState, AgentThread } from "@jet/agents"
import { AlertCircle, Loader2 } from "lucide-react"
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react"
import { AgentMarkdown } from "./AgentMarkdown.js"
import { AgentPatchView } from "./AgentPatchView.js"
import { ChangedFilesCard } from "./ChangedFilesTree.js"
import { ChatComposer } from "./composer/ChatComposer.js"
import {
  deriveProviderInstanceEntries,
  resolveDefaultProviderSelection,
} from "./providerInstances.js"

export const AgentChatView = memo(function AgentChatView(props: {
  thread: AgentThread | null
  providers: AgentProvidersState | null
  theme: "light" | "dark"
  onSend: (payload: {
    text: string
    provider: string | null
    model: string | null
  }) => Promise<void>
  onSelectionChange?: (instanceId: string, model: string) => void
}) {
  const { thread, providers, theme, onSend, onSelectionChange } = props
  const [submitting, setSubmitting] = useState(false)
  const [expandAll, setExpandAll] = useState(true)
  const [composerOverlayHeight, setComposerOverlayHeight] = useState(120)
  const composerOverlayRef = useRef<HTMLDivElement | null>(null)

  const instanceEntries = useMemo(() => deriveProviderInstanceEntries(providers), [providers])
  const defaultSelection = useMemo(
    () => resolveDefaultProviderSelection(instanceEntries, thread?.provider, thread?.model),
    [instanceEntries, thread?.provider, thread?.model],
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

  async function handleSend(payload: { text: string; instanceId: string; model: string }) {
    if (submitting) return
    setSubmitting(true)
    try {
      await onSend({
        text: payload.text,
        provider: payload.instanceId,
        model: payload.model,
      })
    } finally {
      setSubmitting(false)
    }
  }

  if (!thread) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select an agent to view its conversation.
      </div>
    )
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      <div className="border-b border-border px-4 py-3">
        <div className="font-medium text-foreground">{thread.title}</div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {thread.status === "running" ? <Loader2 className="size-3 animate-spin" /> : null}
          {thread.status === "error" && thread.lastError ? (
            <>
              <AlertCircle className="size-3 text-destructive" />
              <span className="text-destructive">{thread.lastError}</span>
            </>
          ) : (
            <span>{thread.workspaceRootPath}</span>
          )}
        </div>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
        style={{ paddingBottom: composerOverlayHeight + 8 }}
      >
        <div className="mx-auto flex max-w-4xl flex-col gap-5">
          {thread.messages.map(message => {
            return (
              <div
                key={message.id}
                className={
                  message.role === "user"
                    ? "ml-auto w-full max-w-3xl rounded-2xl border border-border bg-card/80 p-4"
                    : "w-full max-w-4xl rounded-2xl border border-border/70 bg-card/40 p-4"
                }
              >
                <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  {message.role}
                </div>
                <AgentMarkdown text={message.text} theme={theme} />
                {message.changedFiles && message.changedFiles.length > 0 ? (
                  <ChangedFilesCard
                    files={message.changedFiles}
                    allDirectoriesExpanded={expandAll}
                    onToggleAllDirectories={() => setExpandAll(value => !value)}
                  />
                ) : null}
                {message.diffPatch ? (
                  <div className="mt-4 overflow-hidden rounded-xl border border-input bg-card">
                    <AgentPatchView patch={message.diffPatch} theme={theme} />
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
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
          <ChatComposer
            providers={providers}
            instanceId={defaultSelection?.instanceId ?? thread.provider}
            model={defaultSelection?.model ?? thread.model}
            disabled={thread.status === "running"}
            isRunning={thread.status === "running"}
            isSendBusy={submitting}
            onInstanceModelChange={(instanceId, model) => onSelectionChange?.(instanceId, model)}
            onSend={handleSend}
          />
        </div>
      </div>
    </div>
  )
})
