import type { PanelId } from "@yaade/shared"

export type SidebarGroupingStrategy = "project" | "unread-first"

export type SidebarSessionStatus =
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "disconnected"

export type SidebarSession = {
  id: string
  projectId: string
  projectName: string
  projectPath: string
  title: string
  /** Optional one-line summary under the title (agent activity / last prompt). */
  description?: string
  agent: string
  agentLabel: string
  status: SidebarSessionStatus
  /** ISO timestamp when the user archived the session; active sessions omit this. */
  archivedAt?: string
  unreadCount: number
  lastActivityAt: string
  isPinned: boolean
  /** Set when the session is open in the tiled workspace; null when closed (still in sidebar). */
  panelId: PanelId | null
}

export type SidebarProject = {
  id: string
  name: string
  path: string
  rootUri: string
  sessions: SidebarSession[]
  /** True when any session is running/waiting. */
  hasActive: boolean
  /** Max lastActivityAt among sessions (ISO). */
  lastAccessedAt: string
  unreadCount: number
}

export type SidebarGroupResult = {
  id: string
  label?: string
  project?: SidebarProject
  sessions: SidebarSession[]
}

export type SidebarGroupingDefinition = {
  id: SidebarGroupingStrategy
  label: string
  group(
    projects: SidebarProject[],
    sessions: SidebarSession[],
  ): SidebarGroupResult[]
}
