import type { PanelId } from "@gharargah/shared"

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
  agent: string
  agentLabel: string
  status: SidebarSessionStatus
  unreadCount: number
  lastActivityAt: string
  isPinned: boolean
  panelId: PanelId
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
