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

export type AgentDriverKind = "cli" | "acp"

export type AgentDriverStatus = "ready" | "unavailable" | "pending"

/** One transport implementation for an agent; each agent selects its active driver. */
export type AgentDriverSnapshot = {
  id: string
  kind: AgentDriverKind
  status: AgentDriverStatus
  message?: string | null
}

/** An agent identity independent from the transport used to run it. */
export type AgentSnapshot = {
  id: string
  displayName: string
  enabled: boolean
  activeDriverId: string
  drivers: AgentDriverSnapshot[]
  models: ProviderModel[]
}

export type AgentCatalogState = {
  agents: AgentSnapshot[]
  updatedAt: string
}

/** @deprecated Compatibility view for the older provider-based picker. */
export type ProviderSnapshotStatus = AgentDriverStatus

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
  /** Stable agent identity (codex, claude, opencode, cursor, cursor-acp). */
  agentId: string | null
  /** Selected transport implementation, such as codex:cli. */
  driverId: string | null
  /** Agent-owned ACP session id used to restore the conversation after reconnecting. */
  acpSessionId?: string | null
  /** Live tool/status hint while a turn is running. */
  activity?: string | null
  /** @deprecated Read-only migration field for threads created before agentId. */
  provider?: string | null
  model: string | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  status: AgentThreadStatus
  lastError: string | null
  messages: AgentMessage[]
}

export type AgentThreadDelta = {
  workspaceRootUri: string
  threadId: string
  updatedAt: string
  status: AgentThreadStatus
  lastError: string | null
  messageId: string
  text: string
  streaming: boolean
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
  agentId?: string | null
  driverId?: string | null
  /** @deprecated Use agentId. */
  provider?: string | null
  model?: string | null
}

export type SendAgentMessageInput = {
  workspaceRootUri: string
  workspaceRootPath: string
  threadId: string
  text: string
  agentId?: string | null
  driverId?: string | null
  /** @deprecated Use agentId. */
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
  agentId?: string | null
  driverId?: string | null
  /** @deprecated Use agentId. */
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
  listAgents(): Promise<AgentCatalogState>
  refreshAgents(): Promise<AgentCatalogState>
  /** @deprecated Compatibility APIs for older clients. */
  listProviders?(): Promise<AgentProvidersState>
  refreshProviders?(): Promise<AgentProvidersState>
  onThreadUpdated?(callback: (thread: AgentThread) => void): () => void
  onThreadDelta?(callback: (delta: AgentThreadDelta) => void): () => void
}
