import type {
  HomeProjectGroup,
  HomeTerminalEntry,
} from "../home-session-types.js"
import {
  detectSessionProvider,
  mapRuntimeStatusToCardStatus,
  providerDisplayLabel,
  sessionAgentLabel,
  type SessionCardStatus,
} from "../session-card-model.js"
import type {
  SidebarProject,
  SidebarSession,
  SidebarSessionStatus,
} from "./types.js"

function mapCardStatusToSidebar(status: SessionCardStatus): SidebarSessionStatus {
  switch (status) {
    case "running":
    case "testing":
    case "planning":
      return "running"
    case "queued":
    case "approval":
      return "waiting"
    case "failed":
      return "failed"
    case "archived":
      return "completed"
    case "idle":
    default:
      return "disconnected"
  }
}

function mapRuntimeToSidebar(
  status: HomeTerminalEntry["status"],
): SidebarSessionStatus {
  switch (status) {
    case "starting":
    case "running":
      return "running"
    case "failed":
      return "failed"
    case "exited":
      return "disconnected"
    default:
      return "completed"
  }
}

export type MapHomeToSidebarOptions = {
  unreadBySession?: Record<string, number>
  lastActivityBySession?: Record<string, string>
  nowIso?: string
}

export function mapTerminalToSidebarSession(
  group: HomeProjectGroup,
  term: HomeTerminalEntry,
  opts: MapHomeToSidebarOptions = {},
): SidebarSession {
  const agentId =
    term.session?.agentId ?? term.agentId ?? detectSessionProvider(term.launchCommand)
  const cardStatus =
    term.session?.status ??
    mapRuntimeStatusToCardStatus(term.status, Boolean(term.archivedAt))
  const status = term.session
    ? mapCardStatusToSidebar(cardStatus)
    : mapRuntimeToSidebar(term.status)
  const agent = agentId ?? "terminal"
  const agentLabel = agentId
    ? sessionAgentLabel(agentId)
    : providerDisplayLabel("terminal", undefined)
  const lastActivityAt =
    opts.lastActivityBySession?.[term.tabId] ??
    opts.nowIso ??
    new Date(0).toISOString()

  return {
    id: term.tabId,
    projectId: group.id,
    projectName: group.name,
    projectPath: group.path,
    title: term.session?.title ?? term.label,
    agent,
    agentLabel,
    status,
    ...(term.archivedAt ? { archivedAt: term.archivedAt } : {}),
    unreadCount: opts.unreadBySession?.[term.tabId] ?? 0,
    lastActivityAt,
    isPinned: false,
    panelId: term.panelId,
  }
}

export function mapHomeGroupsToSidebar(
  groups: HomeProjectGroup[],
  opts: MapHomeToSidebarOptions = {},
): { projects: SidebarProject[]; sessions: SidebarSession[] } {
  const projects: SidebarProject[] = []
  const sessions: SidebarSession[] = []

  for (const group of groups) {
    const projectSessions = group.terminals.map(t =>
      mapTerminalToSidebarSession(group, t, opts),
    )
    for (const s of projectSessions) sessions.push(s)
    const unreadCount = projectSessions.reduce((n, s) => n + s.unreadCount, 0)
    const hasActive = projectSessions.some(
      s => s.status === "running" || s.status === "waiting",
    )
    let lastAccessedAt = opts.nowIso ?? new Date(0).toISOString()
    for (const s of projectSessions) {
      if (new Date(s.lastActivityAt).getTime() > new Date(lastAccessedAt).getTime()) {
        lastAccessedAt = s.lastActivityAt
      }
    }
    projects.push({
      id: group.id,
      name: group.name,
      path: group.path,
      rootUri: group.rootUri,
      sessions: projectSessions,
      hasActive,
      lastAccessedAt,
      unreadCount,
    })
  }

  return { projects, sessions }
}
