export type AgentMessageRole = "user" | "assistant" | "system"

export type AgentThreadStatus =
  | "idle"
  | "connecting"
  | "authenticating"
  | "running"
  | "waiting_for_permission"
  | "cancelling"
  | "cancelled"
  | "interrupted"
  | "disconnected"
  | "reconnecting"
  | "error"

export type AgentFileChange = {
  path: string
  additions: number
  deletions: number
}

export type AgentFileReference = {
  projectId?: string
  path: string
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
}

export type AgentMessageAttachment = {
  name: string
  mimeType?: string | null
  path?: string | null
  kind: "file" | "image"
}

export type AgentMessage = {
  id: string
  role: AgentMessageRole
  text: string
  createdAt: string
  updatedAt: string
  streaming: boolean
  attachments?: AgentMessageAttachment[]
  diffPatch?: string
  changedFiles?: AgentFileChange[]
}

export type AgentToolCallStatus = "pending" | "running" | "completed" | "failed" | "cancelled"

export type AgentToolCall = {
  id: string
  name: string
  /** Compact file, command, query, or URL identity shown in the collapsed row. */
  summary?: string
  kind?: string
  status: AgentToolCallStatus
  input?: string
  output?: string
  error?: string | null
  startedAt?: string | null
  completedAt?: string | null
}

export type AgentPermissionOption = {
  id: string
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always" | "unknown"
  label: string
}

export type AgentPermissionRequest = {
  id: string
  title: string
  description?: string | null
  scope?: string | null
  /** T3-aligned request kind for composer/timeline summaries. */
  requestKind?: ProviderRequestKind | null
  /** Command, path, or other identity shown under the title. */
  detail?: string | null
  options?: ReadonlyArray<AgentPermissionOption | "allow_once" | "allow_always" | "reject" | "reject_once" | "reject_always">
  createdAt: string
  sessionId?: string | null
  status?: "pending" | "submitting" | "resolved" | "cancelled" | "rejected"
  toolCall?: {
    name?: string
    kind?: string
    locations?: ReadonlyArray<{ path?: string }>
    rawInput?: unknown
  } | null
}

export type ProviderRequestKind = "command" | "file-read" | "file-change" | "other"

export type ProviderApprovalDecision =
  | "accept"
  | "acceptForSession"
  | "decline"
  | "cancel"

export type AgentUserInputQuestion = {
  id: string
  prompt: string
  header?: string | null
  allowMultiple?: boolean
  multiSelect?: boolean
  options?: ReadonlyArray<{ id: string; label: string; description?: string | null }>
}

export type AgentUserInputRequest = {
  id: string
  kind: "ask_question" | "elicitation"
  source?: string
  title: string
  message?: string | null
  questions?: ReadonlyArray<AgentUserInputQuestion>
  createdAt: string
  status?: "pending" | "submitting" | "resolved" | "cancelled"
}

export type AgentSessionConfigOption = {
  id: string
  name: string
  description?: string
  category?: string
  currentValue?: string
  values?: Array<{ value: string; name: string }>
}

export type AgentPlanEntry = {
  id: string
  label: string
  status: "pending" | "in_progress" | "completed" | "failed"
}

export type AgentPlan = {
  id: string
  entries: ReadonlyArray<AgentPlanEntry>
  updatedAt: string
}

export type AgentUsage = {
  used: number
  limit?: number | null
  unit?: string | null
}

export type AgentConnectionState = {
  status: "connected" | "connecting" | "authenticating" | "disconnected" | "reconnecting" | "error"
  message?: string | null
  authMethods?: string[] | null
  providerId?: string | null
  updatedAt: string
}

export type AgentAvailableCommand = {
  name: string
  description?: string
}

export type AgentTimelineItem =
  | { id: string; kind: "user" | "assistant" | "system"; text: string; createdAt: string; updatedAt?: string; streaming?: boolean }
  | { id: string; kind: "thought"; text: string; createdAt: string }
  | { id: string; kind: "tool_call"; toolCall: AgentToolCall; createdAt: string }
  | { id: string; kind: "permission"; permission: AgentPermissionRequest; createdAt: string }
  | { id: string; kind: "plan"; plan: AgentPlan; createdAt: string }
  | { id: string; kind: "terminal"; text: string; createdAt: string }
  | { id: string; kind: "connection" | "auth" | "cancellation" | "error"; text: string; createdAt: string }
  | { id: string; kind: "usage"; usage: AgentUsage; createdAt: string }
  | { id: string; kind: "user_input"; userInput: AgentUserInputRequest; createdAt: string }

export type ProviderModel = {
  slug: string
  name: string
  shortName?: string
  configOptions?: AgentSessionConfigOption[]
}

/** Mirrors `AgentTransportKind` in `@gharargah/rpc`; duplicated because this
 * package sits below rpc in the dependency graph. Keep both in sync. */
export type AgentDriverKind = "cli" | "acp" | "app-server" | "sdk" | "mock"

export type AgentDriverStatus = "ready" | "unavailable" | "pending"

/** One transport implementation for an agent; each agent selects its active driver. */
export type AgentDriverSnapshot = {
  id: string
  kind: AgentDriverKind
  status: AgentDriverStatus
  message?: string | null
  /** True when the driver is advertised but intentionally limited (e.g. Cursor CLI). */
  degraded?: boolean
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
  /**
   * Login-shell PATH resolution. The picker stays loading until `ready`;
   * `error` means the probe failed and agent availability may be understated.
   */
  shellEnvStatus?: "loading" | "ready" | "error"
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
  /** Stable continuation grouping for multi-instance providers. */
  continuationGroupKey?: string
  /** Isolated HOME for Claude (and similar) instances. */
  homePath?: string | null
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
  /** Stable agent identity (codex, claude, opencode, cursor, grok). */
  agentId: string | null
  /** Selected transport implementation, such as codex:app-server or cursor:acp. */
  driverId: string | null
  /** Agent-owned ACP session id used to restore the conversation after reconnecting. */
  acpSessionId?: string | null
  /** ACP provider id bound to this thread (may differ from catalog agentId). */
  acpProvider?: string | null
  /** Native provider conversation/session id used for resume. */
  providerSessionId?: string | null
  /** Native structured transport bound to this thread. */
  providerTransport?: "codex-app-server" | "claude-sdk" | string | null
  runtimeMode?: "approval-required" | "auto-accept-edits" | "auto" | "full-access" | null
  /** Cursor-style interaction mode mapped to ACP session/set_mode. */
  interactionMode?: "implement" | "plan" | "ask" | null
  /** Available ACP session modes from session/new|load|resume. */
  sessionModes?: {
    currentModeId: string
    availableModes: Array<{ id: string; name: string; description?: string | null }>
  } | null
  permissionRules?: Array<{ scope: string; optionId: string }> | null
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
  timeline?: AgentTimelineItem[]
  pendingPermissions?: AgentPermissionRequest[]
  pendingUserInputs?: AgentUserInputRequest[]
  usage?: AgentUsage | null
  plan?: AgentPlan | null
  connection?: AgentConnectionState | null
  availableCommands?: ReadonlyArray<AgentAvailableCommand>
  configOptions?: Array<AgentSessionConfigOption> | null
  discoveredModels?: ProviderModel[] | null
  acpSequence?: number
  /** Provider account/instance id used in ACP connection keys. */
  providerInstanceId?: string | null
  /** Lightweight transcript checkpoints (message/timeline cursors). */
  checkpoints?: ReadonlyArray<{
    id: string
    createdAt: string
    label: string
    messageCount: number
    timelineCount: number
    turnId?: string | null
    /** @deprecated Destructive stash create removed; kept for legacy revert. */
    gitStashMessage?: string | null
    /** HEAD at checkpoint create (non-destructive). */
    gitRef?: string | null
  }> | null
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

export type AgentStructuredDelta = {
  workspaceRootUri: string
  threadId: string
  sequence: number
  updatedAt: string
  created?: AgentTimelineItem[]
  updated?: AgentTimelineItem[]
  status?: AgentThreadStatus
  turnState?: "idle" | "running" | "completed" | "failed" | "cancelled"
  pendingPermissions?: AgentPermissionRequest[]
  pendingUserInputs?: AgentUserInputRequest[]
  usage?: AgentUsage | null
  plan?: AgentPlan | null
  connection?: AgentConnectionState | null
  lastError?: string | null
  configOptions?: Array<AgentSessionConfigOption> | null
  discoveredModels?: ProviderModel[] | null
  sessionModes?: AgentThread["sessionModes"]
  availableCommands?: ReadonlyArray<AgentAvailableCommand> | null
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
  runtimeMode?: "approval-required" | "auto-accept-edits" | "full-access" | null
  interactionMode?: "implement" | "plan" | "ask" | null
}

export type SendAgentMessageInput = {
  workspaceRootUri: string
  workspaceRootPath: string
  threadId: string
  text: string
  /** Idempotency key — duplicate submits replay the accepted receipt. */
  commandId?: string | null
  agentId?: string | null
  driverId?: string | null
  /** @deprecated Use agentId. */
  provider?: string | null
  model?: string | null
  /** Optional image attachments (max 8 attachments total). */
  images?: ReadonlyArray<{ data: string; mimeType: string; name?: string }> | null
  /** Local-path or inline text file attachments (max 8 attachments total). */
  files?: ReadonlyArray<{
    name: string
    mimeType?: string
    path?: string
    data?: string
  }> | null
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
  commandId?: string | null
}

export type ResolveAgentPermissionInput = {
  workspaceRootUri: string
  workspaceRootPath: string
  threadId: string
  permissionId: string
  commandId?: string | null
  /** Preferred: exact provider option id. */
  optionId?: string
  /** Legacy ACP option kinds. */
  decision?: "allow_once" | "allow_always" | "reject" | "reject_once" | "reject_always"
  /** T3-aligned decision vocabulary. */
  approvalDecision?: ProviderApprovalDecision
}

export type ResolveAgentUserInputInput = {
  workspaceRootUri: string
  workspaceRootPath: string
  threadId: string
  requestId: string
  commandId?: string | null
  answers?: ReadonlyArray<{ questionId: string; selected: string[] }>
  action?: "accept" | "decline" | "cancel"
  content?: Record<string, unknown>
}

export type SetAgentSessionConfigOptionInput = {
  workspaceRootUri: string
  workspaceRootPath: string
  threadId: string
  configId: string
  value: string
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
  runtimeMode?: "approval-required" | "auto-accept-edits" | "full-access" | null
  interactionMode?: "implement" | "plan" | "ask" | null
}

/** View-model message shape consumed by MessagesTimeline. */
export type TimelineChatMessage = {
  id: string
  role: AgentMessageRole
  text: string
  createdAt: string
  updatedAt: string
  streaming: boolean
  attachments?: ReadonlyArray<AgentMessageAttachment>
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
  | {
      id: string
      kind: "structured"
      createdAt: string
      item: AgentTimelineItem
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
  createCheckpoint?(input: {
    workspaceRootUri?: string
    workspaceRootPath: string
    threadId: string
    label?: string
    turnId?: string
  }): Promise<{ id: string }>
  revertCheckpoint?(input: {
    workspaceRootUri?: string
    workspaceRootPath: string
    threadId: string
    checkpointId: string
  }): Promise<AgentThread>
  interruptTurn(input: InterruptAgentTurnInput): Promise<AgentThread | null>
  resolvePermission?(input: ResolveAgentPermissionInput): Promise<void>
  resolveUserInput?(input: ResolveAgentUserInputInput): Promise<void>
  setSessionConfigOption?(input: SetAgentSessionConfigOptionInput): Promise<void>
  setArchived(input: SetAgentThreadArchivedInput): Promise<AgentThread | null>
  updateThreadSettings(input: UpdateAgentThreadSettingsInput): Promise<AgentThread | null>
  listAgents(): Promise<AgentCatalogState>
  refreshAgents(providerId?: string): Promise<AgentCatalogState>
  /** @deprecated Compatibility APIs for older clients. */
  listProviders?(): Promise<AgentProvidersState>
  refreshProviders?(): Promise<AgentProvidersState>
  onThreadUpdated?(callback: (thread: AgentThread) => void): () => void
  onThreadDelta?(callback: (delta: AgentThreadDelta) => void): () => void
  onPermissionRequest?(callback: (input: {
    workspaceRootUri: string
    threadId: string
    permission: AgentPermissionRequest
  }) => void): () => void
  onStructuredDelta?(callback: (delta: AgentStructuredDelta) => void): () => void
  /** Fires once login-shell PATH is applied (or skipped / timed out). */
  onShellEnvReady?(callback: () => void): () => void
  getAcpTrace?(providerId?: string): Promise<unknown>
  getConnectionState?(
    provider?: string | { providerId?: string; workspaceRootPath?: string },
  ): Promise<AgentConnectionState | null>
  forceStopProvider?(input: {
    connectionKey?: string
    providerId?: string
    workspaceRootPath?: string
  }): Promise<void>
  listAcpSessions?(input: {
    connectionKey?: string
    providerId?: string
    workspaceRootPath?: string
  }): Promise<unknown>
  authenticate?(input: {
    connectionKey?: string
    providerId?: string
    workspaceRootPath?: string
    methodId?: string
  }): Promise<void>
  closeAcpSession?(input: {
    connectionKey?: string
    providerId?: string
    workspaceRootPath?: string
    sessionId: string
  }): Promise<void>
  deleteAcpSession?(input: {
    connectionKey?: string
    providerId?: string
    workspaceRootPath?: string
    sessionId: string
  }): Promise<void>
  logoutProvider?(input: {
    connectionKey?: string
    providerId?: string
    workspaceRootPath?: string
  }): Promise<void>
}
