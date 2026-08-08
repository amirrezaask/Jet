import type { HqAgentSummary } from "@yaade/rpc"

export type HqAgentFilter = "all" | "attention" | "working" | "idle"

/** Agent process is gone — hide from live pickers even if a shell PTY lingers. */
const INACCESSIBLE_AGENT_STATUSES = new Set<HqAgentSummary["status"]>([
  "completed",
  "failed",
  "terminated",
  "disconnected",
])

export function isAccessibleHqAgent(agent: HqAgentSummary): boolean {
  return !INACCESSIBLE_AGENT_STATUSES.has(agent.status)
}

function activityBucket(agent: HqAgentSummary): number {
  if (agent.attention) return 0
  if (agent.unreadCount > 0) return 1
  if (agent.status === "working" || agent.status === "running_tool") return 2
  if (agent.status === "starting") return 3
  if (agent.status === "idle") return 4
  return 5
}

export function sortHqAgents(agents: readonly HqAgentSummary[]): HqAgentSummary[] {
  return agents
    .map((agent, index) => ({ agent, index }))
    .sort((a, b) => {
      const bucket = activityBucket(a.agent) - activityBucket(b.agent)
      if (bucket !== 0) return bucket
      const recent = (b.agent.lastActivityAt ?? "").localeCompare(
        a.agent.lastActivityAt ?? "",
      )
      return recent || a.index - b.index
    })
    .map(item => item.agent)
}

export function filterHqAgents(
  agents: readonly HqAgentSummary[],
  input: {
    query: string
    projectId: string
    filter: HqAgentFilter
  },
): HqAgentSummary[] {
  const query = input.query.trim().toLowerCase()
  return sortHqAgents(agents).filter(agent => {
    if (!isAccessibleHqAgent(agent)) return false
    if (input.projectId && agent.projectId !== input.projectId) return false
    if (input.filter === "attention" && !agent.attention) return false
    if (
      input.filter === "working" &&
      agent.status !== "working" &&
      agent.status !== "running_tool" &&
      agent.status !== "starting"
    ) {
      return false
    }
    if (input.filter === "idle" && agent.status !== "idle") return false
    if (!query) return true
    return [
      agent.title,
      agent.provider,
      agent.projectName,
      agent.projectPath,
      agent.projectSessionTitle,
      agent.worktreeBranch ?? "",
      agent.activity,
    ]
      .join(" ")
      .toLowerCase()
      .includes(query)
  })
}
