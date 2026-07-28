import { useRef } from "react"
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

export function UnreadFirstSessionList({
  sessions,
  selectedSessionId,
  actions,
  onSelectSession,
  compact = false,
  showProjectMeta = true,
}: UnreadFirstSessionListProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: sessions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 12,
    getItemKey: index => sessions[index]?.id ?? index,
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
            const session = sessions[item.index]
            if (!session) return null
            return (
              <div
                key={session.id}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <SessionSidebarItem
                  session={session}
                  selected={selectedSessionId === session.id}
                  showProjectMeta={showProjectMeta}
                  compact={compact}
                  actions={actions}
                  onSelect={onSelectSession}
                />
              </div>
            )
          })}
        </SidebarMenu>
      </div>
    </div>
  )
}
