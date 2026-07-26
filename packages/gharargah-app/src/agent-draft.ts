import type { AgentThread } from "@gharargah/agents"

const DRAFT_THREAD_PREFIX = "draft:"

export function createAgentDraftThread(input: {
  tabId: string
  workspaceRootUri: string
  workspaceRootPath: string
  preferredAgentId?: string | null
}): AgentThread {
  const now = new Date().toISOString()
  return {
    id: `${DRAFT_THREAD_PREFIX}${input.tabId}`,
    title: "New agent",
    workspaceRootUri: input.workspaceRootUri,
    workspaceRootPath: input.workspaceRootPath,
    agentId: input.preferredAgentId ?? null,
    driverId: null,
    model: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    status: "idle",
    lastError: null,
    messages: [],
    timeline: [],
    pendingPermissions: [],
    pendingUserInputs: [],
    configOptions: [],
    discoveredModels: [],
  }
}

export function isAgentDraftThread(
  thread: AgentThread | null | undefined,
): boolean {
  return Boolean(thread?.id.startsWith(DRAFT_THREAD_PREFIX))
}
