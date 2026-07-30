import type { SidebarProject, SidebarSession } from "../types.js"

function activityMs(iso: string): number {
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : 0
}

function isActiveStatus(status: SidebarSession["status"]): boolean {
  return status === "running" || status === "waiting"
}

/** Sort sessions inside a project: open before done, then unread → active → recent. */
export function sortSessionsInProject(sessions: SidebarSession[]): SidebarSession[] {
  return [...sessions].sort((a, b) => {
    const aDone = Boolean(a.doneAt)
    const bDone = Boolean(b.doneAt)
    if (aDone !== bDone) return aDone ? 1 : -1
    const aUnread = a.unreadCount > 0
    const bUnread = b.unreadCount > 0
    if (aUnread !== bUnread) return aUnread ? -1 : 1
    const aActive = isActiveStatus(a.status)
    const bActive = isActiveStatus(b.status)
    if (aActive !== bActive) return aActive ? -1 : 1
    const byActivity = activityMs(b.lastActivityAt) - activityMs(a.lastActivityAt)
    if (byActivity !== 0) return byActivity
    return a.title.localeCompare(b.title)
  })
}

/**
 * Project order: unread → active → recently accessed → alphabetical.
 */
export function sortProjects(projects: SidebarProject[]): SidebarProject[] {
  return [...projects].sort((a, b) => {
    const aUnread = a.unreadCount > 0
    const bUnread = b.unreadCount > 0
    if (aUnread !== bUnread) return aUnread ? -1 : 1
    if (a.hasActive !== b.hasActive) return a.hasActive ? -1 : 1
    const byAccess = activityMs(b.lastAccessedAt) - activityMs(a.lastAccessedAt)
    if (byAccess !== 0) return byAccess
    return a.name.localeCompare(b.name)
  })
}

export function withSortedProjectSessions(project: SidebarProject): SidebarProject {
  return {
    ...project,
    sessions: sortSessionsInProject(project.sessions),
  }
}
