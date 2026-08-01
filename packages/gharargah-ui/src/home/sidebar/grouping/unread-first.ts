import type { SidebarSession } from "../types.js"

/** Open before done; unread first within each bucket; then latest activity. */
export function sortSessionsUnreadFirst(
  sessions: SidebarSession[],
): SidebarSession[] {
  return [...sessions].sort((a, b) => {
    const aArchived = Boolean(a.archivedAt)
    const bArchived = Boolean(b.archivedAt)
    if (aArchived !== bArchived) return aArchived ? 1 : -1
    const aUnread = a.unreadCount > 0
    const bUnread = b.unreadCount > 0
    if (aUnread !== bUnread) return aUnread ? -1 : 1
    return (
      new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
    )
  })
}

/**
 * Keep the selected session at its prior visual index while its unread state
 * changes, so mark-as-read does not jump the list under the user.
 */
export function applyStickySelectedOrder(
  sorted: SidebarSession[],
  previousOrder: string[],
  selectedSessionId: string | null,
): SidebarSession[] {
  if (!selectedSessionId || previousOrder.length === 0) return sorted
  const stickyIndex = previousOrder.indexOf(selectedSessionId)
  if (stickyIndex < 0) return sorted
  const selected = sorted.find(s => s.id === selectedSessionId)
  if (!selected) return sorted
  const rest = sorted.filter(s => s.id !== selectedSessionId)
  const next = [...rest]
  next.splice(Math.min(stickyIndex, next.length), 0, selected)
  return next
}

/**
 * Pin relative order of existing sessions across activity/unread churn.
 * New ids prepend (activity-sorted among themselves). Gone ids drop.
 * Open vs done still respected via `sortSessionsUnreadFirst` for newcomers only.
 */
export function applyStickyListOrder(
  sessions: SidebarSession[],
  previousOrder: string[],
): SidebarSession[] {
  if (previousOrder.length === 0) return sortSessionsUnreadFirst(sessions)
  const byId = new Map(sessions.map(s => [s.id, s]))
  const kept: SidebarSession[] = []
  for (const id of previousOrder) {
    const session = byId.get(id)
    if (!session) continue
    kept.push(session)
    byId.delete(id)
  }
  if (byId.size === 0) return kept
  const newcomers = sortSessionsUnreadFirst([...byId.values()])
  return [...newcomers, ...kept]
}
