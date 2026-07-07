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

export type InterruptAgentTurnInput = {
  workspaceRootUri: string
  workspaceRootPath: string
  threadId: string
}

export type UpdateAgentThreadSettingsInput = {
  workspaceRootUri: string
  workspaceRootPath: string
  threadId: string
  provider?: string | null
  model?: string | null
}

/** View-model message shape consumed by MessagesTimeline. */
export type TimelineChatMessage = {
  id: string
  role: AgentMessageRole
  text: string
  createdAt: string
  updatedAt: string
  streaming: boolean
  turnId?: string | null
  diffPatch?: string
  changedFiles?: AgentFileChange[]
}

export type TurnDiffSummary = {
  turnId: string
  completedAt: string
  files: ReadonlyArray<AgentFileChange>
}

export type TimelineEntry =
  | {
      id: string
      kind: "message"
      createdAt: string
      message: TimelineChatMessage
    }
  | {
      id: string
      kind: "proposed-plan"
      createdAt: string
      proposedPlan: { id: string; planMarkdown: string; createdAt: string }
    }
  | {
      id: string
      kind: "work"
      createdAt: string
      entry: {
        id: string
        createdAt: string
        turnId?: string | null
        label: string
        tone?: string
      }
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
  interruptTurn(input: InterruptAgentTurnInput): Promise<AgentThread | null>
  setArchived(input: SetAgentThreadArchivedInput): Promise<AgentThread | null>
  updateThreadSettings(input: UpdateAgentThreadSettingsInput): Promise<AgentThread | null>
  listProviders(): Promise<AgentProvidersState>
  refreshProviders(): Promise<AgentProvidersState>
  onThreadUpdated?(callback: (thread: AgentThread) => void): () => void
}
