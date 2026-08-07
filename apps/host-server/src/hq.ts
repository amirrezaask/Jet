import fs from "node:fs"
import path from "node:path"
import {
  describeAgentActivity,
  type AgentProvider,
  type AgentSessionSnapshot,
} from "@yaade/agents"
import {
  HqAgentSummary,
  HqProjectSummary,
  HqSnapshot,
  type HqAttentionKind,
} from "@yaade/rpc"
import { fileUriToPath } from "@yaade/shared"
import type { HostRuntime } from "./host-runtime.js"
import { pathAllowed } from "./sandbox.js"

const AGENT_COMMANDS: Record<string, AgentProvider> = {
  claude: "claude",
  codex: "codex",
  "cursor-agent": "cursor",
  cursor: "cursor",
  opencode: "opencode",
  grok: "grok",
}

export function inferAgentProvider(
  explicit: string | undefined,
  launchCommand: string | undefined,
): AgentProvider | null {
  if (
    explicit === "claude" ||
    explicit === "codex" ||
    explicit === "cursor" ||
    explicit === "opencode" ||
    explicit === "grok"
  ) {
    return explicit
  }
  if (!launchCommand) return null
  const basename = path.basename(launchCommand).replace(/\.(?:cmd|exe)$/i, "")
  return AGENT_COMMANDS[basename.toLowerCase()] ?? null
}

function canonicalPath(value: string): string {
  try {
    return fs.realpathSync(path.resolve(value))
  } catch {
    return path.resolve(value)
  }
}

function leafCwd(cwdRootUri: string, fallback: string): string {
  try {
    return fileUriToPath(cwdRootUri)
  } catch {
    return fallback
  }
}

function snapshotAttention(
  snapshot: Omit<AgentSessionSnapshot, "_internal"> | null,
  notificationAttention: number,
): HqAttentionKind | null {
  if (snapshot?.attention?.kind === "permission_required") {
    return "permission_required"
  }
  if (snapshot?.attention?.kind === "turn_failed") return "turn_failed"
  if (snapshot?.attention?.kind === "session_failed") return "session_failed"
  if (snapshot?.attention?.kind === "session_terminated") {
    return "session_terminated"
  }
  if (snapshot?.status === "waiting_for_permission") {
    return "permission_required"
  }
  if (snapshot?.status === "waiting_for_user") return "waiting_for_user"
  if (snapshot?.status === "failed") return "turn_failed"
  if (notificationAttention > 0) return "permission_required"
  return null
}

function availability(
  rootPath: string,
  allowedRoots: string[],
): "available" | "missing" | "forbidden" {
  if (!pathAllowed(rootPath, allowedRoots)) return "forbidden"
  try {
    return fs.statSync(rootPath).isDirectory() ? "available" : "missing"
  } catch {
    return "missing"
  }
}

function newestTimestamp(values: Array<string | null | undefined>): string | null {
  let newest: string | null = null
  for (const value of values) {
    if (value && (!newest || value > newest)) newest = value
  }
  return newest
}

export function buildHqSnapshot(runtime: HostRuntime): HqSnapshot {
  const projects = runtime.db.projects()
  const sessions = runtime.db.listAllProjectSessions(runtime.machineHostname)
  const projectByPath = new Map(
    projects.map(project => [canonicalPath(project.rootPath), project]),
  )
  const unreadBySession = runtime.notifications.unreadBySession()
  const unreadByProject = runtime.notifications.unreadByProject()
  const attentionBySession = runtime.notifications.attentionBySession()
  const attentionByProject = runtime.notifications.attentionByProject()
  const claimedPtyIds = new Set<string>()
  const agents: HqAgentSummary[] = []

  // Project sessions are newest-first, so the first repeated PTY mapping wins.
  for (const projectSession of sessions) {
    if (projectSession.archivedAt) continue
    for (const leaf of projectSession.payload.sessions) {
      const ptyId = leaf.ptyId
      if (!ptyId || claimedPtyIds.has(ptyId)) continue
      const provider = inferAgentProvider(leaf.agentProvider, leaf.launchCommand)
      if (!provider) continue
      claimedPtyIds.add(ptyId)
      const inspected = runtime.terminal.inspect(ptyId)
      if (!inspected || inspected.status !== "running") continue

      const project = projectByPath.get(canonicalPath(projectSession.projectPath))
      if (!project) continue
      const sessionId = leaf.ptyTabId
      const snapshot = runtime.agents.getSnapshot(sessionId)
      const binding = runtime.notifications.bindingForSession(sessionId)
      const unreadCount = unreadBySession[sessionId] ?? 0
      const attention = snapshotAttention(
        snapshot,
        attentionBySession[sessionId] ?? 0,
      )
      const startedAt = snapshot?.startedAt ?? null
      const runtimeMs = snapshot?.runtime.processRuntimeMs ?? 0
      const providerTitle = provider.charAt(0).toUpperCase() + provider.slice(1)

      agents.push(
        HqAgentSummary.make({
          sessionId,
          ptyId,
          projectId: project.id,
          projectName: project.name,
          projectPath: project.rootPath,
          projectSessionId: projectSession.id,
          projectSessionTitle: projectSession.title,
          cwdPath: leafCwd(leaf.cwdRootUri, projectSession.cwdPath),
          worktreeBranch: projectSession.worktreeBranch,
          provider,
          title:
            binding?.sessionTitle ?? leaf.agentTitle ?? inspected.title ?? providerTitle,
          status: snapshot?.status ?? "starting",
          activity: snapshot ? describeAgentActivity(snapshot) : "Telemetry connecting",
          telemetry: snapshot ? "connected" : "pending",
          startedAt,
          lastActivityAt: snapshot?.lastActivityAt ?? projectSession.updatedAt,
          runtimeMs,
          unreadCount,
          attention,
          currentTool: snapshot?.currentTool
            ? {
                name: snapshot.currentTool.name,
                category: snapshot.currentTool.category,
              }
            : null,
        }),
      )
    }
  }

  const projectSummaries = projects.map(project => {
    const projectSessions = sessions.filter(
      session =>
        !session.archivedAt &&
        canonicalPath(session.projectPath) === canonicalPath(project.rootPath),
    )
    const projectAgents = agents.filter(agent => agent.projectId === project.id)
    const liveAttention = projectAgents.filter(agent => agent.attention != null).length
    return HqProjectSummary.make({
      id: project.id,
      name: project.name,
      rootPath: project.rootPath,
      availability: availability(project.rootPath, runtime.config.allowedRoots),
      sessionCount: projectSessions.length,
      liveAgentCount: projectAgents.length,
      attentionCount: Math.max(
        liveAttention,
        attentionByProject[project.id] ?? 0,
      ),
      unreadCount: unreadByProject[project.id] ?? 0,
      lastActivityAt: newestTimestamp([
        project.updatedAt,
        ...projectSessions.map(session => session.updatedAt),
        ...projectAgents.map(agent => agent.lastActivityAt),
      ]),
    })
  })

  return HqSnapshot.make({
    version: 1,
    generatedAt: new Date().toISOString(),
    machineHostname: runtime.machineHostname,
    notificationCounts: runtime.notifications.counts(),
    projects: projectSummaries,
    agents,
  })
}
