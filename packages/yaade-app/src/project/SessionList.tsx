import type { ProjectSessionSummary } from "@yaade/rpc"
import { cn, yaadeInteractiveRowClass, yaadePressClass } from "@yaade/ui"
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@yaade/ui/primitives"
import { GitBranchIcon, MoreHorizontalIcon } from "lucide-react"

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
  return (
    <div
      className="min-h-[12rem]"
      data-yaade-session-list=""
      data-yaade-list-panel="project-sessions"
    >
      <ul className="flex flex-col gap-0.5" aria-label="Project sessions">
        {sessions.map(session => (
          <li key={session.id}>
            <div
              role="button"
              tabIndex={0}
              className={cn(
                yaadeInteractiveRowClass,
                yaadePressClass,
                "flex w-full shrink-0 cursor-pointer items-center gap-3 rounded-md px-2 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              )}
              data-yaade-list-item=""
              data-yaade-session-row={session.id}
              onClick={() => onOpen(session.id)}
              onKeyDown={event => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  onOpen(session.id)
                }
              }}
            >
              <div className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {session.title}
                  </span>
                  {session.worktreeBranch ? (
                    <Badge
                      variant="outline"
                      className="gap-1 font-mono text-3xs"
                    >
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
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={`Session actions for ${session.title}`}
                  onClick={event => event.stopPropagation()}
                  onPointerDown={event => event.stopPropagation()}
                >
                  <MoreHorizontalIcon className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onOpen(session.id)}>
                    Open
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      const next = window.prompt(
                        "Rename session",
                        session.title,
                      )
                      if (next?.trim()) void onRename(session.id, next.trim())
                    }}
                  >
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => void onArchive(session.id)}
                  >
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
          </li>
        ))}
      </ul>
    </div>
  )
}
