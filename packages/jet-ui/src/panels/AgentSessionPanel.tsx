import type {
  AgentProviderKind,
  AgentSessionDocument,
  TranscriptItem,
} from "@jet/agents"
import { providerLabel } from "@jet/agents"
import { useCallback, useEffect, useRef, useState } from "react"
import type { WorkspaceService } from "@jet/workspace"
import { Bot, Loader2, Sparkles, Terminal, User } from "lucide-react"
import { Button } from "@/components/ui/button.js"
import { Bubble, BubbleContent } from "@/components/ui/bubble.js"
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker.js"
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@/components/ui/message.js"
import { MessageScroller, MessageScrollerItem } from "@/components/ui/message-scroller.js"
import { JetCaretInput } from "@/motion/useJetCaretOverlay.js"
import { cn } from "@/lib/utils.js"

function providerIcon(provider: AgentProviderKind) {
  switch (provider) {
    case "codex":
    case "opencode":
      return <Terminal className="size-3.5" />
    case "cursor":
      return <Sparkles className="size-3.5" />
    default:
      return <Bot className="size-3.5" />
  }
}

function useAgentDoc(workspace: WorkspaceService, tabId: string): AgentSessionDocument | null {
  const [, setRev] = useState(0)
  const folderState = workspace.folderStateForAgentTab(tabId)

  useEffect(() => {
    if (!folderState) return
    return folderState.agents.onDidChange.event(evt => {
      if (evt.tabId === tabId) setRev(r => r + 1)
    }).dispose
  }, [workspace, folderState, tabId])

  return folderState?.agents.get(tabId) ?? null
}

function TranscriptRow({ item, provider }: { item: TranscriptItem; provider: AgentProviderKind }) {
  if (item.kind === "marker") {
    if (item.variant === "separator") {
      return (
        <MessageScrollerItem messageId={item.id}>
          <Marker variant="separator" role="separator">
            <MarkerContent className="border-none bg-transparent text-center text-[11px] uppercase tracking-wide">
              {item.text}
            </MarkerContent>
          </Marker>
        </MessageScrollerItem>
      )
    }
    return (
      <MessageScrollerItem messageId={item.id}>
        <Marker
          variant={item.variant === "error" ? "error" : item.variant === "approval" ? "approval" : "status"}
          role={item.variant === "status" ? "status" : undefined}
        >
          <MarkerIcon>{providerIcon(provider)}</MarkerIcon>
          <MarkerContent
            className={cn(
              item.variant === "status" && item.text.includes("Thinking") && "animate-pulse",
            )}
          >
            {item.text}
          </MarkerContent>
        </Marker>
      </MessageScrollerItem>
    )
  }

  const align = item.role === "user" ? "end" : "start"
  return (
    <MessageScrollerItem messageId={item.id}>
      <Message align={align}>
        <MessageAvatar>
          {item.role === "user" ? <User className="size-3.5" /> : providerIcon(provider)}
        </MessageAvatar>
        <MessageContent>
          <MessageHeader>{item.role === "user" ? "You" : providerLabel(provider)}</MessageHeader>
          <Bubble align={align}>
            <BubbleContent>{item.text || (item.streaming ? "…" : "")}</BubbleContent>
          </Bubble>
          {item.streaming && (
            <MessageFooter className="flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" />
              Streaming
            </MessageFooter>
          )}
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  )
}

export type AgentSessionPanelProps = {
  tabId: string
  workspace: WorkspaceService
  focused: boolean
  isActive: boolean
}

export function AgentSessionPanel({ tabId, workspace, focused, isActive }: AgentSessionPanelProps) {
  const doc = useAgentDoc(workspace, tabId)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const startedRef = useRef(false)

  const startSession = useCallback(async () => {
    if (!doc || startedRef.current) return
    startedRef.current = true
    const folderState = workspace.folderStateForAgentTab(tabId)
    if (!folderState) return

    if (doc.stubMode || !window.jet?.agents) {
      folderState.agents.applyEvent(tabId, {
        type: "session/ready",
        sessionId: doc.sessionId,
        folderId: doc.folderId,
        provider: doc.provider,
      })
      return
    }

    try {
      await window.jet.agents.startSession({
        sessionId: doc.sessionId,
        folderId: doc.folderId,
        workspacePath: doc.workspacePath,
        workspaceRootUri: folderState.root.uri,
        provider: doc.provider,
      })
    } catch (err) {
      folderState.agents.applyEvent(tabId, {
        type: "session/error",
        sessionId: doc.sessionId,
        folderId: doc.folderId,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }, [doc, tabId, workspace])

  useEffect(() => {
    if (!doc || !isActive) return
    void startSession()
  }, [doc, isActive, startSession])

  useEffect(() => {
    if (!window.jet?.agents?.onEvent || !doc) return
    return window.jet.agents.onEvent(event => {
      if (event.sessionId !== doc.sessionId) return
      const folderState = workspace.folderStateForAgentTab(tabId)
      folderState?.agents.applyEvent(tabId, event)
    })
  }, [doc, tabId, workspace])

  const sendTurn = useCallback(async () => {
    const text = draft.trim()
    if (!text || !doc) return
    const folderState = workspace.folderStateForAgentTab(tabId)
    if (!folderState) return

    setSending(true)
    setDraft("")

    const messageId = `user-${Date.now()}`
    folderState.agents.applyEvent(tabId, {
      type: "message/delta",
      sessionId: doc.sessionId,
      folderId: doc.folderId,
      messageId,
      role: "user",
      delta: text,
    })
    folderState.agents.applyEvent(tabId, {
      type: "message/done",
      sessionId: doc.sessionId,
      folderId: doc.folderId,
      messageId,
    })

    if (doc.stubMode || !window.jet?.agents) {
      setSending(false)
      return
    }

    try {
      await window.jet.agents.sendTurn({ sessionId: doc.sessionId, text })
    } catch (err) {
      folderState.agents.applyEvent(tabId, {
        type: "session/error",
        sessionId: doc.sessionId,
        folderId: doc.folderId,
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setSending(false)
    }
  }, [draft, doc, tabId, workspace])

  const respondApproval = useCallback(
    async (decision: "approve" | "deny") => {
      if (!doc?.pendingApproval || !window.jet?.agents) return
      await window.jet.agents.respondApproval({
        sessionId: doc.sessionId,
        requestId: doc.pendingApproval.requestId,
        decision,
      })
      const folderState = workspace.folderStateForAgentTab(tabId)
      folderState?.agents.update(tabId, { pendingApproval: null })
    },
    [doc, tabId, workspace],
  )

  const interrupt = useCallback(async () => {
    if (!doc?.sessionId || !window.jet?.agents) return
    await window.jet.agents.interrupt(doc.sessionId)
  }, [doc])

  if (!doc) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Agent session not found
      </div>
    )
  }

  const composerDisabled =
    doc.stubMode || doc.status === "connecting" || doc.status === "closed" || doc.status === "error"
  const canSend = !composerDisabled && !sending && draft.trim().length > 0

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-jet-agent-panel=""
      data-jet-tab-kind="agent"
      data-jet-agent-provider={doc.provider}
      data-jet-agent-status={doc.status}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5 text-xs">
        <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-medium text-foreground">
          {providerIcon(doc.provider)}
          {providerLabel(doc.provider)}
        </span>
        <span className="truncate text-muted-foreground">{doc.workspaceName}</span>
        <span className="ml-auto text-muted-foreground capitalize">{doc.status}</span>
        {doc.status === "streaming" && (
          <Button type="button" size="xs" variant="outline" onClick={() => void interrupt()}>
            Stop
          </Button>
        )}
      </div>

      <MessageScroller stickToBottom={doc.status === "streaming" || focused}>
        {doc.transcript.map(item => (
          <TranscriptRow key={item.id} item={item} provider={doc.provider} />
        ))}
      </MessageScroller>

      {doc.pendingApproval && !doc.stubMode && (
        <div className="flex shrink-0 gap-2 border-t border-border p-2">
          <Button type="button" size="sm" onClick={() => void respondApproval("approve")}>
            Approve
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => void respondApproval("deny")}>
            Deny
          </Button>
        </div>
      )}

      <form
        className="flex shrink-0 gap-2 border-t border-border p-2"
        onSubmit={e => {
          e.preventDefault()
          void sendTurn()
        }}
      >
        <JetCaretInput
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder={
            doc.stubMode
              ? "Agents require Jet desktop"
              : doc.status === "ready"
                ? `Message ${providerLabel(doc.provider)}…`
                : "Waiting for session…"
          }
          disabled={composerDisabled}
          data-jet-agent-composer=""
          className="min-w-0 flex-1"
        />
        <Button type="submit" size="sm" disabled={!canSend}>
          Send
        </Button>
      </form>
    </div>
  )
}
