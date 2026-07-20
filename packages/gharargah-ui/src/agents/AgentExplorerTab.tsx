import type { AgentThreadSummary, AgentWorkspaceSnapshot } from "@gharargah/agents"
import { AlertCircle, Archive, ArchiveRestore, ChevronRight, Loader2, MessageSquarePlus, MessagesSquare } from "lucide-react"
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { SidebarContent } from "../components/ui/sidebar.js"
import { cn } from "../lib/utils.js"
import { Button } from "../components/ui/button.js"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../components/ui/context-menu.js"
import { ListRow } from "@/components/ListRow.js"
import { PanelEmpty } from "@/components/PanelEmpty.js"
import { registerListPanel } from "../lib/list-registry.js"

export const AGENT_EXPLORER_LIST_ID = "gharargah:agent-explorer"

export type AgentExplorerWorkspaceGroup = {
  id: string
  name: string
  path: string
  rootUri: string
  snapshot: AgentWorkspaceSnapshot | null
  archivedThreads: ReadonlyArray<AgentThreadSummary>
}

const OVERSCAN = 8
const GROUP_HEADER_HEIGHT = 40
const THREAD_ROW_HEIGHT = 32
const GROUP_EMPTY_HEIGHT = 28
const ARCHIVED_HEADER_HEIGHT = 32

type VirtualRow =
  | { kind: "group-header"; group: AgentExplorerWorkspaceGroup; expanded: boolean }
  | { kind: "group-empty"; groupId: string }
  | { kind: "thread"; thread: AgentThreadSummary; rootUri: string; rootPath: string; archived: boolean }
  | { kind: "archived-header"; count: number }

function rowHeight(row: VirtualRow): number {
  switch (row.kind) {
    case "group-header":
      return GROUP_HEADER_HEIGHT
    case "thread":
      return THREAD_ROW_HEIGHT
    case "group-empty":
      return GROUP_EMPTY_HEIGHT
    case "archived-header":
      return ARCHIVED_HEADER_HEIGHT
  }
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
        <ListRow
          data-gharargah-list-item
          className="h-full min-h-0 flex-row items-center gap-2 rounded-md px-2 py-1"
          onClick={onOpen}
          title={`${thread.title} — ${formatRelativeTime(thread.updatedAt)}${thread.messageCount > 0 ? ` · ${thread.messageCount} messages` : ""}${thread.status !== "idle" ? ` · ${thread.status}` : ""}`}
        >
          <ThreadStatusIcon status={thread.status} />
          <span data-slot="row-label" className="min-w-0 flex-1 truncate text-xs text-foreground">
            {thread.title}
          </span>
          <span data-slot="row-detail" className="shrink-0 text-3xs tabular-nums text-muted-foreground">
            {formatRelativeTime(thread.updatedAt)}
          </span>
        </ListRow>
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
  const scrollRef = useRef<HTMLDivElement | null>(null)
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

  const flatRows = useMemo((): VirtualRow[] => {
    const rows: VirtualRow[] = []
    for (const group of sortedGroups) {
      const expanded = expandedRoots.has(group.id)
      rows.push({ kind: "group-header", group, expanded })
      if (!expanded) continue
      const threads = group.snapshot?.threads ?? []
      if (threads.length === 0) {
        rows.push({ kind: "group-empty", groupId: group.id })
      } else {
        for (const thread of threads) {
          rows.push({
            kind: "thread",
            thread,
            rootUri: group.rootUri,
            rootPath: group.path,
            archived: false,
          })
        }
      }
    }
    if (archivedCount > 0) {
      rows.push({ kind: "archived-header", count: archivedCount })
      if (archivedExpanded) {
        for (const group of sortedGroups) {
          for (const thread of group.archivedThreads) {
            rows.push({
              kind: "thread",
              thread,
              rootUri: group.rootUri,
              rootPath: group.path,
              archived: true,
            })
          }
        }
      }
    }
    return rows
  }, [sortedGroups, expandedRoots, archivedExpanded, archivedCount])

  useLayoutEffect(() => {
    setExpandedRoots(current => {
      const next = new Set(current)
      let changed = false
      for (const group of groups) {
        if (!next.has(group.id)) {
          next.add(group.id)
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [groups])

  useEffect(() => {
    return registerListPanel(AGENT_EXPLORER_LIST_ID, scrollRef.current)
  }, [flatRows.length])

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: index => rowHeight(flatRows[index]!),
    overscan: OVERSCAN,
  })

  return (
    <SidebarContent
      className="flex min-h-0 flex-col px-1 py-2"
      data-gharargah-list-panel={AGENT_EXPLORER_LIST_ID}
      tabIndex={-1}
    >
      <div className="mb-1 shrink-0 px-2 text-3xs uppercase tracking-[0.16em] text-muted-foreground">
        Agents
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto"
      >
        {flatRows.length === 0 ? (
          <PanelEmpty
            title="No workspaces open"
            description="Open a workspace before starting an agent."
            compact
          />
        ) : (
          <div
            style={{
              height: virtualizer.getTotalSize(),
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map(v => {
              const row = flatRows[v.index]!
              return (
                <div
                  key={v.key}
                  data-gharargah-list-row
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: v.size,
                    transform: `translateY(${v.start}px)`,
                  }}
                >
                  {row.kind === "group-header" ? (
                    <div className="h-full border-b border-sidebar-border/60 px-1">
                      <div className="flex h-full items-center gap-1">
                        <Button
                          variant="ghost"
                          className="h-7 min-w-0 flex-1 justify-start gap-1.5 px-1 text-left font-normal"
                          onClick={() =>
                            setExpandedRoots(current => {
                              const next = new Set(current)
                              if (next.has(row.group.id)) next.delete(row.group.id)
                              else next.add(row.group.id)
                              return next
                            })
                          }
                        >
                          <ChevronRight
                            className={cn(
                              "size-3.5 text-muted-foreground transition-transform duration-[var(--gharargah-motion-fast)]",
                              row.expanded && "rotate-90",
                            )}
                          />
                          <span className="truncate text-xs font-medium text-foreground" title={row.group.path}>
                            {row.group.name}
                          </span>
                        </Button>
                        <Button
                          size="icon-sm"
                          title="New agent"
                          variant="ghost"
                          onClick={() => void onCreateThread(row.group.rootUri, row.group.path)}
                        >
                          <MessageSquarePlus className="size-4" />
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  {row.kind === "group-empty" ? (
                    <div className="px-8 py-1 text-3xs text-muted-foreground">No agents yet.</div>
                  ) : null}
                  {row.kind === "archived-header" ? (
                    <div className="h-full border-b border-sidebar-border/60 px-1">
                      <Button
                        variant="ghost"
                        className="h-7 w-full justify-start gap-1.5 px-1 text-left font-normal"
                        onClick={() => setArchivedExpanded(current => !current)}
                      >
                        <ChevronRight
                          className={cn(
                            "size-3.5 text-muted-foreground transition-transform duration-[var(--gharargah-motion-fast)]",
                            archivedExpanded && "rotate-90",
                          )}
                        />
                        <span className="text-xs text-muted-foreground">Archived ({row.count})</span>
                      </Button>
                    </div>
                  ) : null}
                  {row.kind === "thread" ? (
                    <ThreadRow
                      archived={row.archived}
                      thread={row.thread}
                      onOpen={() => onOpenThread(row.rootUri, row.thread.id)}
                      onArchive={
                        row.archived
                          ? undefined
                          : () => onArchiveThread?.(row.rootUri, row.rootPath, row.thread.id)
                      }
                      onUnarchive={
                        row.archived
                          ? () => onUnarchiveThread?.(row.rootUri, row.rootPath, row.thread.id)
                          : undefined
                      }
                    />
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </SidebarContent>
  )
})
