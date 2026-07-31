import {
  sortProjects,
  withSortedProjectSessions,
} from "./project.js"
import { sortSessionsUnreadFirst } from "./unread-first.js"
import type {
  SidebarGroupingDefinition,
  SidebarGroupResult,
  SidebarProject,
  SidebarSession,
} from "../types.js"

export const projectGrouping: SidebarGroupingDefinition = {
  id: "project",
  label: "Project",
  group(projects: SidebarProject[], _sessions: SidebarSession[]): SidebarGroupResult[] {
    return sortProjects(projects.map(withSortedProjectSessions)).map(project => ({
      id: project.id,
      label: project.name,
      project,
      sessions: project.sessions,
    }))
  },
}

export const unreadFirstGrouping: SidebarGroupingDefinition = {
  id: "unread-first",
  label: "Unread First",
  group(_projects: SidebarProject[], sessions: SidebarSession[]): SidebarGroupResult[] {
    return [
      {
        id: "all-sessions",
        sessions: sortSessionsUnreadFirst(sessions),
      },
    ]
  },
}

const REGISTRY: Record<string, SidebarGroupingDefinition> = {
  project: projectGrouping,
  "unread-first": unreadFirstGrouping,
}

export function getGroupingDefinition(
  strategy: "project" | "unread-first",
): SidebarGroupingDefinition {
  return REGISTRY[strategy] ?? projectGrouping
}

export function applyGrouping(
  strategy: "project" | "unread-first",
  projects: SidebarProject[],
  sessions: SidebarSession[],
): SidebarGroupResult[] {
  return getGroupingDefinition(strategy).group(projects, sessions)
}

export {
  sortProjects,
  sortSessionsInProject,
  withSortedProjectSessions,
} from "./project.js"
export {
  applyStickyListOrder,
  applyStickySelectedOrder,
  sortSessionsUnreadFirst,
} from "./unread-first.js"
