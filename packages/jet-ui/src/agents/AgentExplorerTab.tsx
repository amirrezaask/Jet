import type { AgentThreadSummary, AgentWorkspaceSnapshot } from "@jet/agents"
import { AlertCircle, Archive, ArchiveRestore, ChevronRight, Loader2, MessageSquarePlus, MessagesSquare } from "lucide-react"
import { memo, useEffect, useMemo, useRef, useState } from "react"
import { SidebarContent } from "../components/ui/sidebar.js"
import { cn } from "../lib/utils.js"
import { Button } from "../components/ui/button.js"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../components/ui/context-menu.js"
import { registerListPanel } from "../lib/list-registry.js"

export type AgentExplorerWorkspaceGroup = {
  id: string
  name: string
  path: string
  rootUri: string
  snapshot: AgentWorkspaceSnapshot | null
  archivedThreads: ReadonlyArray<AgentThreadSummary>
}

function formatRelativeTime(iso: string): string {
  const deltaMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(deltaMs / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

function ThreadStatusIcon(props: { status: AgentWorkspaceSnapshot["threads"][number]["status"] }) {
  if (props.status === "running") {
    return <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
  }
  if (props.status === "error") {
    return <AlertCircle className="size-3.5 shrink-0 text-destructive" />
  }
  return <MessagesSquare className="size-4 shrink-0 text-muted-foreground" />
}

function ThreadRow(props: {
  thread: AgentThreadSummary
  onOpen: () => void
  onArchive?: () => void
  onUnarchive?: () => void
  archived?: boolean
}) {
  const { thread, onOpen, onArchive, onUnarchive, archived = false } = props
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          data-jet-list-item
          className="flex w-full shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-sidebar-accent focus-visible:bg-sidebar-accent focus-visible:outline-none"
          onClick={onOpen}
          type="button"
        >
          <ThreadStatusIcon status={thread.status} />
          <div className="min-w-0 flex-1">
            <span data-slot="row-label" className="block truncate text-sm text-foreground">
              {thread.title}
            </span>
            <span data-slot="row-detail" className="block truncate text-3xs text-muted-foreground">
              {formatRelativeTime(thread.updatedAt)}
              {thread.messageCount > 0 ? ` · ${thread.messageCount} messages` : ""}
              {thread.status !== "idle" ? ` · ${thread.status}` : ""}
            </span>
          </div>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {archived ? (
          <ContextMenuItem onSelect={onUnarchive}>
            <ArchiveRestore className="size-4" />
            Unarchive
          </ContextMenuItem>
        ) : (
          <ContextMenuItem onSelect={onArchive}>
            <Archive className="size-4" />
            Archive
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

export const AgentExplorerTab = memo(function AgentExplorerTab(props: {
  groups: AgentExplorerWorkspaceGroup[]
  onOpenThread: (rootUri: string, threadId: string) => void
  onCreateThread: (rootUri: string, rootPath: string) => Promise<void> | void
  onArchiveThread?: (rootUri: string, rootPath: string, threadId: string) => void
  onUnarchiveThread?: (rootUri: string, rootPath: string, threadId: string) => void
}) {
  const { groups, onOpenThread, onCreateThread, onArchiveThread, onUnarchiveThread } = props
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [expandedRoots, setExpandedRoots] = useState<ReadonlySet<string>>(
    () => new Set(groups.map(group => group.id)),
  )
  const [archivedExpanded, setArchivedExpanded] = useState(false)

  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => a.name.localeCompare(b.name)),
    [groups],
  )

  const archivedCount = useMemo(
    () => sortedGroups.reduce((sum, group) => sum + group.archivedThreads.length, 0),
    [sortedGroups],
  )

  useEffect(() => registerListPanel("jet:agent-explorer", contentRef.current), [])

  return (
    <SidebarContent
      ref={contentRef}
      className="min-h-0 overflow-auto p-2"
      data-jet-list-panel="agent-explorer"
      tabIndex={-1}
    >
      <div className="mb-2 px-2 text-3xs uppercase tracking-[0.16em] text-muted-foreground">
        Agents
      </div>
      <div className="space-y-2">
        {sortedGroups.map(group => {
          const expanded = expandedRoots.has(group.id)
          return (
            <div key={group.id} className="rounded-xl border border-border/60 bg-card/30">
              <div className="flex items-center gap-1 px-2 py-2">
                <button
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() =>
                    setExpandedRoots(current => {
                      const next = new Set(current)
                      if (next.has(group.id)) next.delete(group.id)
                      else next.add(group.id)
                      return next
                    })
                  }
                  type="button"
                >
                  <ChevronRight
                    className={cn(
                      "size-4 text-muted-foreground transition-transform",
                      expanded && "rotate-90",
                    )}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{group.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{group.path}</div>
                  </div>
                </button>
                <Button
                  size="icon-sm"
                  title="New agent"
                  variant="ghost"
                  onClick={() => void onCreateThread(group.rootUri, group.path)}
                >
                  <MessageSquarePlus className="size-4" />
                </Button>
              </div>
              {expanded ? (
                <div className="space-y-1 px-2 pb-2">
                  {(group.snapshot?.threads ?? []).length === 0 ? (
                    <div className="rounded-lg px-3 py-2 text-xs text-muted-foreground">
                      No agents yet.
                    </div>
                  ) : (
                    group.snapshot!.threads.map(thread => (
                      <ThreadRow
                        key={thread.id}
                        thread={thread}
                        onOpen={() => onOpenThread(group.rootUri, thread.id)}
                        onArchive={() => onArchiveThread?.(group.rootUri, group.path, thread.id)}
                      />
                    ))
                  )}
                </div>
              ) : null}
            </div>
          )
        })}
        {archivedCount > 0 ? (
          <div className="rounded-xl border border-border/60 bg-card/20">
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-left"
              onClick={() => setArchivedExpanded(current => !current)}
              type="button"
            >
              <ChevronRight
                className={cn(
                  "size-4 text-muted-foreground transition-transform",
                  archivedExpanded && "rotate-90",
                )}
              />
              <span className="text-sm text-muted-foreground">Archived ({archivedCount})</span>
            </button>
            {archivedExpanded ? (
              <div className="space-y-1 px-2 pb-2">
                {sortedGroups.flatMap(group =>
                  group.archivedThreads.map(thread => (
                    <ThreadRow
                      key={`${group.id}:${thread.id}`}
                      archived
                      thread={thread}
                      onOpen={() => onOpenThread(group.rootUri, thread.id)}
                      onUnarchive={() =>
                        onUnarchiveThread?.(group.rootUri, group.path, thread.id)
                      }
                    />
                  )),
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </SidebarContent>
  )
})
