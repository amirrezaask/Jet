import { useMemo, useRef } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { SidebarMenu } from "@/components/ui/sidebar.js"
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

function buildRows(sessions: SidebarSession[]): ListRow[] {
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
    })
    for (const session of archived) {
      rows.push({ kind: "session", id: session.id, session, section: "archived" })
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
  const rows = useMemo(() => buildRows(sessions), [sessions])
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
        data-gharargah-sidebar-empty="no-sessions"
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
      data-gharargah-sidebar-unread-list=""
      data-gharargah-list-panel="sidebar-sessions"
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
                      "data-gharargah-sidebar-session-section": row.section,
                    }
                  : row.kind === "header"
                    ? {
                        "data-gharargah-sidebar-section-label": row.section,
                      }
                    : {
                        "data-gharargah-sidebar-session-section": row.section,
                      })}
              >
                {row.kind === "header" ? (
                  <div className="px-2 pt-1 text-3xs font-medium uppercase tracking-wide text-muted-foreground">
                    {row.label}
                  </div>
                ) : row.kind === "empty" ? (
                  <div className="px-2 py-1.5 text-3xs text-muted-foreground">
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
