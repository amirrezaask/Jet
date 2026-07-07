export type AgentMessageRole = "user" | "assistant" | "system"

export type AgentThreadStatus = "idle" | "running" | "error"

export type AgentFileChange = {
  path: string
  additions: number
  deletions: number
}

export type AgentMessage = {
  id: string
  role: AgentMessageRole
  text: string
  createdAt: string
  updatedAt: string
  streaming: boolean
  diffPatch?: string
  changedFiles?: AgentFileChange[]
}

export type ProviderModel = {
  slug: string
  name: string
  shortName?: string
}

export type ProviderSnapshotStatus = "ready" | "unavailable" | "pending"

export type ProviderSnapshot = {
  instanceId: string
  driverKind: string
  displayName: string
  enabled: boolean
  status: ProviderSnapshotStatus
  message?: string | null
  models: ProviderModel[]
}

export type AgentProvidersState = {
  providers: ProviderSnapshot[]
  updatedAt: string
}

export type AgentThread = {
  id: string
  title: string
  workspaceRootUri: string
  workspaceRootPath: string
  /** Provider instance id (e.g. codex, claudeAgent). Legacy threads may store driver slug in provider. */
  provider: string | null
  model: string | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  status: AgentThreadStatus
  lastError: string | null
  messages: AgentMessage[]
}

export type AgentThreadSummary = {
  id: string
  title: string
  updatedAt: string
  createdAt: string
  archivedAt: string | null
  status: AgentThreadStatus
  lastError: string | null
  latestUserMessageAt: string | null
  messageCount: number
}

export type AgentWorkspaceSnapshot = {
  workspaceRootUri: string
  workspaceRootPath: string
  threads: AgentThreadSummary[]
}

export type CreateAgentThreadInput = {
  workspaceRootUri: string
  workspaceRootPath: string
  title?: string
  provider?: string | null
  model?: string | null
}

export type SendAgentMessageInput = {
  workspaceRootUri: string
  workspaceRootPath: string
  threadId: string
  text: string
  provider?: string | null
  model?: string | null
}

export type SetAgentThreadArchivedInput = {
  workspaceRootUri: string
  workspaceRootPath: string
  threadId: string
  archived: boolean
}

export type AgentTransport = {
  listThreads(
    workspaceRootUri: string,
    workspaceRootPath: string,
  ): Promise<AgentWorkspaceSnapshot>
  readThread(
    workspaceRootUri: string,
    workspaceRootPath: string,
    threadId: string,
  ): Promise<AgentThread | null>
  createThread(input: CreateAgentThreadInput): Promise<AgentThread>
  sendMessage(input: SendAgentMessageInput): Promise<AgentThread>
  setArchived(input: SetAgentThreadArchivedInput): Promise<AgentThread | null>
  listProviders(): Promise<AgentProvidersState>
  refreshProviders(): Promise<AgentProvidersState>
}
