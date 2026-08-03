import type { SidebarProject, SidebarSession } from "./types.js"

export type SessionSearchHaystack = {
  title: string
  projectName: string
  projectPath: string
  agent: string
  agentLabel: string
}

export function sessionMatchesQuery(
  session: SidebarSession,
  query: string,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const haystack = [
    session.title,
    session.projectName,
    session.projectPath,
    session.agent,
    session.agentLabel,
  ]
    .join(" ")
    .toLowerCase()
  return haystack.includes(q)
}

/** Filter sessions; Project mode drops projects with zero matches. */
export function filterProjectsBySessionQuery(
  projects: SidebarProject[],
  query: string,
): SidebarProject[] {
  const q = query.trim()
  if (!q) return projects
  return projects
    .map(project => ({
      ...project,
      sessions: project.sessions.filter(s => sessionMatchesQuery(s, q)),
    }))
    .filter(project => project.sessions.length > 0)
}

export function filterSessionsByQuery(
  sessions: SidebarSession[],
  query: string,
): SidebarSession[] {
  const q = query.trim()
  if (!q) return sessions
  return sessions.filter(s => sessionMatchesQuery(s, q))
}
