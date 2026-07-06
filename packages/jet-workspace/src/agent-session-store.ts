import { Emitter } from "@jet/shared"
import {
  type AgentProviderKind,
  type AgentSessionDocument,
  type AgentSessionStatus,
  type AgentEvent,
  applyAgentEvent,
  stubWelcomeTranscript,
  providerLabel,
} from "@jet/agents"
import { agentTabId, allocAgentSessionKey } from "./tab-registry.js"

export class AgentSessionStore {
  private sessions = new Map<string, AgentSessionDocument>()
  readonly onDidChange = new Emitter<{ tabId: string }>()

  list(): AgentSessionDocument[] {
    return [...this.sessions.values()]
  }

  get(tabId: string): AgentSessionDocument | undefined {
    return this.sessions.get(tabId)
  }

  create(input: {
    folderId: string
    provider: AgentProviderKind
    workspacePath: string
    workspaceName: string
    label: string
    stubMode: boolean
    sessionKey?: string
  }): AgentSessionDocument {
    const sessionKey = input.sessionKey ?? allocAgentSessionKey()
    const tabId = agentTabId(sessionKey)
    const sessionId = `sess-${sessionKey}`
    const doc: AgentSessionDocument = {
      tabId,
      sessionId,
      folderId: input.folderId,
      provider: input.provider,
      label: input.label,
      status: "connecting",
      workspacePath: input.workspacePath,
      workspaceName: input.workspaceName,
      transcript: stubWelcomeTranscript(providerLabel(input.provider), input.stubMode),
      pendingApproval: null,
      createdAt: Date.now(),
      stubMode: input.stubMode,
    }
    this.sessions.set(tabId, doc)
    this.onDidChange.fire({ tabId })
    return doc
  }

  update(tabId: string, patch: Partial<AgentSessionDocument>): void {
    const existing = this.sessions.get(tabId)
    if (!existing) return
    this.sessions.set(tabId, { ...existing, ...patch })
    this.onDidChange.fire({ tabId })
  }

  applyEvent(tabId: string, event: AgentEvent): void {
    const existing = this.sessions.get(tabId)
    if (!existing) return
    this.sessions.set(tabId, applyAgentEvent(existing, event))
    this.onDidChange.fire({ tabId })
  }

  setStatus(tabId: string, status: AgentSessionStatus): void {
    this.update(tabId, { status })
  }

  dispose(tabId: string): AgentSessionDocument | undefined {
    const doc = this.sessions.get(tabId)
    if (!doc) return undefined
    this.sessions.delete(tabId)
    this.onDidChange.fire({ tabId })
    return doc
  }

  disposeAll(): AgentSessionDocument[] {
    const docs = this.list()
    this.sessions.clear()
    for (const doc of docs) this.onDidChange.fire({ tabId: doc.tabId })
    return docs
  }
}
