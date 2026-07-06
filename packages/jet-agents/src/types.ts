export const AGENT_PROVIDER_KINDS = ["codex", "claude", "cursor", "opencode"] as const

export type AgentProviderKind = (typeof AGENT_PROVIDER_KINDS)[number]

export type AgentSessionStatus =
  | "connecting"
  | "ready"
  | "streaming"
  | "error"
  | "closed"

export type AgentApprovalDecision = "approve" | "deny"

export type TranscriptRole = "user" | "assistant" | "system"

export type TranscriptItem =
  | {
      kind: "message"
      id: string
      role: TranscriptRole
      text: string
      streaming?: boolean
      createdAt: number
    }
  | {
      kind: "marker"
      id: string
      variant: "status" | "separator" | "tool" | "approval" | "error"
      text: string
      toolName?: string
      requestId?: string
      createdAt: number
    }

export type AgentEvent =
  | {
      type: "session/ready"
      sessionId: string
      folderId: string
      provider: AgentProviderKind
    }
  | {
      type: "session/closed"
      sessionId: string
      folderId: string
    }
  | {
      type: "session/error"
      sessionId: string
      folderId: string
      message: string
    }
  | {
      type: "turn/started"
      sessionId: string
      folderId: string
      turnId: string
    }
  | {
      type: "turn/completed"
      sessionId: string
      folderId: string
      turnId: string
    }
  | {
      type: "message/delta"
      sessionId: string
      folderId: string
      messageId: string
      role: TranscriptRole
      delta: string
    }
  | {
      type: "message/done"
      sessionId: string
      folderId: string
      messageId: string
    }
  | {
      type: "marker"
      sessionId: string
      folderId: string
      marker: Omit<Extract<TranscriptItem, { kind: "marker" }>, "kind">
    }
  | {
      type: "approval/request"
      sessionId: string
      folderId: string
      requestId: string
      summary: string
    }

export type AgentSessionDocument = {
  tabId: string
  sessionId: string
  folderId: string
  provider: AgentProviderKind
  label: string
  status: AgentSessionStatus
  workspacePath: string
  workspaceName: string
  transcript: TranscriptItem[]
  pendingApproval: { requestId: string; summary: string } | null
  createdAt: number
  stubMode: boolean
}

export type AgentProviderHealth = {
  provider: AgentProviderKind
  available: boolean
  authenticated: boolean
  message?: string
}

export type AgentStartSessionRequest = {
  sessionId: string
  folderId: string
  workspacePath: string
  workspaceRootUri: string
  provider: AgentProviderKind
}

export type AgentSendTurnRequest = {
  sessionId: string
  text: string
}

export type AgentRespondApprovalRequest = {
  sessionId: string
  requestId: string
  decision: AgentApprovalDecision
}
