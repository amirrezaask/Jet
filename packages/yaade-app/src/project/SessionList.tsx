import type { ProjectSessionSummary } from "@yaade/rpc"
import { Lister, type ListerNode } from "@yaade/ui"
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@yaade/ui/primitives"
import { GitBranchIcon, MoreHorizontalIcon } from "lucide-react"
import { useMemo, useState } from "react"

export type SessionListProps = {
  sessions: ProjectSessionSummary[]
  formatRelative: (iso: string) => string
  onOpen: (id: string) => void
  onRename: (id: string, title: string) => Promise<void>
  onArchive: (id: string) => Promise<void>
  onDelete: (id: string, removeWorktree: boolean) => Promise<void>
}

export function SessionList({
  sessions,
  formatRelative,
  onOpen,
  onRename,
  onArchive,
  onDelete,
}: SessionListProps) {
  const [query, setQuery] = useState("")
  const items = useMemo(
    () =>
      sessions.map(
        (session): ListerNode<ProjectSessionSummary> => ({
          id: session.id,
          searchText: `${session.title} ${session.worktreeBranch ?? ""} ${session.cwdPath}`,
          data: session,
        }),
      ),
    [sessions],
  )

  return (
    <div className="min-h-[12rem]" data-yaade-session-list="">
      <Lister
        listId="project-sessions"
        mode="flat"
        flatVariant="plain"
        items={items}
        query={query}
        onQueryChange={setQuery}
        showInput
        placeholder="Filter sessions…"
        emptyState="No matching sessions."
        onActivate={node => onOpen(node.data.id)}
        aria-label="Project sessions"
        estimateSize={() => 56}
        render={(node, _ctx) => {
          const session = node.data
          return (
            <div
              className="flex w-full shrink-0 items-center gap-3 px-2 py-2"
              data-yaade-list-item=""
              data-yaade-session-row={session.id}
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => onOpen(session.id)}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {session.title}
                  </span>
                  {session.worktreeBranch ? (
                    <Badge variant="outline" className="gap-1 font-mono text-3xs">
                      <GitBranchIcon className="size-3" />
                      {session.worktreeBranch}
                    </Badge>
                  ) : null}
                </div>
                <p className="truncate text-3xs text-muted-foreground">
                  {session.cwdPath}
                  {" · "}
                  {formatRelative(session.updatedAt)}
                </p>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={`Session actions for ${session.title}`}
                >
                  <MoreHorizontalIcon className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onOpen(session.id)}>
                    Open
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      const next = window.prompt("Rename session", session.title)
                      if (next?.trim()) void onRename(session.id, next.trim())
                    }}
                  >
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void onArchive(session.id)}>
                    Archive
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => void onDelete(session.id, false)}
                  >
                    Delete
                  </DropdownMenuItem>
                  {session.worktreePath ? (
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => void onDelete(session.id, true)}
                    >
                      Delete + remove worktree
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        }}
      />
    </div>
  )
}
