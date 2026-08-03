import { useMemo, useRef, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button.js"
import { SidebarMenu } from "@/components/ui/sidebar.js"
import { cn } from "@/lib/utils.js"
import type { SessionSidebarActions } from "./SessionContextMenu.js"
import { SessionSidebarItem } from "./SessionSidebarItem.js"
import type { SidebarSession } from "./types.js"

export type UnreadFirstSessionListProps = {
  sessions: SidebarSession[]
  selectedSessionId: string | null
  actions: SessionSidebarActions
  onSelectSession: (session: SidebarSession) => void
  compact?: boolean
  showProjectMeta?: boolean
}

const ROW_ESTIMATE = 48
const SECTION_HEADER_ESTIMATE = 28

type ListRow =
  | {
      kind: "header"
      id: string
      label: string
      section: "active" | "archived"
      count?: number
      expandable?: boolean
      expanded?: boolean
    }
  | {
      kind: "session"
      id: string
      session: SidebarSession
      section: "active" | "archived"
    }
  | {
      kind: "empty"
      id: string
      label: string
      section: "active" | "archived"
    }

function buildRows(
  sessions: SidebarSession[],
  archivedExpanded: boolean,
): ListRow[] {
  const active = sessions.filter(session => !session.archivedAt)
  const archived = sessions.filter(session => Boolean(session.archivedAt))
  const rows: ListRow[] = [
    { kind: "header", id: "header:active", label: "Active", section: "active" },
  ]
  if (active.length === 0) {
    rows.push({
      kind: "empty",
      id: "empty:active",
      label: "No active sessions",
      section: "active",
    })
  } else {
    for (const session of active) {
      rows.push({ kind: "session", id: session.id, session, section: "active" })
    }
  }
  if (archived.length > 0) {
    rows.push({
      kind: "header",
      id: "header:archived",
      label: "Archived",
      section: "archived",
      count: archived.length,
      expandable: true,
      expanded: archivedExpanded,
    })
    if (archivedExpanded) {
      for (const session of archived) {
        rows.push({
          kind: "session",
          id: session.id,
          session,
          section: "archived",
        })
      }
    }
  }
  return rows
}

export function UnreadFirstSessionList({
  sessions,
  selectedSessionId,
  actions,
  onSelectSession,
  compact = false,
  showProjectMeta = true,
}: UnreadFirstSessionListProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [archivedExpanded, setArchivedExpanded] = useState(false)
  const rows = useMemo(
    () => buildRows(sessions, archivedExpanded),
    [sessions, archivedExpanded],
  )
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: index =>
      rows[index]?.kind === "session" ? ROW_ESTIMATE : SECTION_HEADER_ESTIMATE,
    overscan: 12,
    getItemKey: index => rows[index]?.id ?? index,
  })

  if (sessions.length === 0) {
    return (
      <div
        className="px-3 py-6 text-center text-xs text-muted-foreground"
        data-yaade-sidebar-empty="no-sessions"
      >
        No matching sessions
        <p className="mt-1 text-3xs">Try another title, project, or agent name.</p>
      </div>
    )
  }

  return (
    <div
      ref={parentRef}
      className="min-h-0 flex-1 overflow-y-auto"
      data-yaade-sidebar-unread-list=""
      data-yaade-list-panel="sidebar-sessions"
    >
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        <SidebarMenu className="absolute inset-x-0 top-0 gap-0.5 px-1">
          {virtualizer.getVirtualItems().map(item => {
            const row = rows[item.index]
            if (!row) return null
            return (
              <div
                key={row.id}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${item.start}px)` }}
                {...(row.kind === "session"
                  ? {
                      "data-yaade-sidebar-session-section": row.section,
                    }
                  : row.kind === "header"
                    ? {
                        "data-yaade-sidebar-section-label": row.section,
                      }
                    : {
                        "data-yaade-sidebar-session-section": row.section,
                      })}
              >
                {row.kind === "header" ? (
                  row.expandable ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="h-auto w-full justify-start gap-1 px-2 py-1 text-3xs font-medium uppercase tracking-wide text-sidebar-foreground/60 hover:bg-transparent hover:text-sidebar-foreground"
                      aria-expanded={row.expanded ?? false}
                      data-yaade-sidebar-section-toggle={row.section}
                      data-state={row.expanded ? "open" : "closed"}
                      onClick={() => setArchivedExpanded(open => !open)}
                    >
                      <ChevronRight
                        className={cn(
                          "size-3 shrink-0 transition-transform duration-[var(--yaade-motion-fast)] ease-[var(--yaade-ease-out)]",
                          row.expanded && "rotate-90",
                        )}
                        aria-hidden
                      />
                      <span className="truncate">{row.label}</span>
                      {typeof row.count === "number" ? (
                        <span className="ml-auto tabular-nums text-sidebar-foreground/45">
                          {row.count}
                        </span>
                      ) : null}
                    </Button>
                  ) : (
                    <div className="px-2 pt-1 text-3xs font-medium uppercase tracking-wide text-sidebar-foreground/60">
                      {row.label}
                    </div>
                  )
                ) : row.kind === "empty" ? (
                  <div className="px-2 py-1.5 text-3xs text-sidebar-foreground/60">
                    {row.label}
                  </div>
                ) : (
                  <SessionSidebarItem
                    session={row.session}
                    selected={selectedSessionId === row.session.id}
                    showProjectMeta={showProjectMeta}
                    compact={compact}
                    actions={actions}
                    onSelect={onSelectSession}
                  />
                )}
              </div>
            )
          })}
        </SidebarMenu>
      </div>
    </div>
  )
}
