import type {
  AgentEvent,
  AgentProviderHealth,
  AgentProviderKind,
  AgentRespondApprovalRequest,
  AgentSendTurnRequest,
  AgentStartSessionRequest,
} from "@jet/agents"
import { AGENT_PROVIDER_KINDS } from "@jet/agents"

export type HostedAgentSession = AgentStartSessionRequest & {
  turnCounter: number
  stubMode: boolean
}

export type AgentHostOptions = {
  onEvent: (event: AgentEvent) => void
}

export class AgentHost {
  private sessions = new Map<string, HostedAgentSession>()

  constructor(private readonly options: AgentHostOptions) {}

  listProviders(): AgentProviderHealth[] {
    return AGENT_PROVIDER_KINDS.map(provider => ({
      provider,
      available: true,
      authenticated: true,
      message: "Stub host — CLI adapters pending",
    }))
  }

  listSessions(folderId?: string): HostedAgentSession[] {
    const all = [...this.sessions.values()]
    if (!folderId) return all
    return all.filter(s => s.folderId === folderId)
  }

  async startSession(req: AgentStartSessionRequest): Promise<{ stubMode: boolean }> {
    const stubMode = process.env.JET_AGENT_STUB === "1"
    const session: HostedAgentSession = { ...req, turnCounter: 0, stubMode }
    this.sessions.set(req.sessionId, session)

    queueMicrotask(() => {
      this.emit({
        type: "session/ready",
        sessionId: req.sessionId,
        folderId: req.folderId,
        provider: req.provider,
      })
      if (stubMode) {
        this.emit({
          type: "marker",
          sessionId: req.sessionId,
          folderId: req.folderId,
          marker: {
            id: `ready-${req.sessionId}`,
            variant: "status",
            text: `Connected to ${req.provider} (desktop stub). Send a message to try the transcript.`,
            createdAt: Date.now(),
          },
        })
      }
    })

    return { stubMode }
  }

  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.sessions.delete(sessionId)
    this.emit({
      type: "session/closed",
      sessionId,
      folderId: session.folderId,
    })
  }

  async stopAllForFolder(folderId: string): Promise<void> {
    for (const session of this.listSessions(folderId)) {
      await this.stopSession(session.sessionId)
    }
  }

  async stopAll(): Promise<void> {
    for (const sessionId of [...this.sessions.keys()]) {
      await this.stopSession(sessionId)
    }
  }

  async sendTurn(req: AgentSendTurnRequest): Promise<void> {
    const session = this.sessions.get(req.sessionId)
    if (!session) throw new Error(`Unknown agent session: ${req.sessionId}`)

    const turnId = `turn-${++session.turnCounter}`
    this.emit({
      type: "turn/started",
      sessionId: session.sessionId,
      folderId: session.folderId,
      turnId,
    })

    const assistantId = `assistant-${Date.now()}`
    const reply = `[${session.provider}] Echo (stub): ${req.text}`

    for (const chunk of reply.match(/.{1,12}/g) ?? [reply]) {
      this.emit({
        type: "message/delta",
        sessionId: session.sessionId,
        folderId: session.folderId,
        messageId: assistantId,
        role: "assistant",
        delta: chunk,
      })
      await delay(20)
    }

    this.emit({
      type: "message/done",
      sessionId: session.sessionId,
      folderId: session.folderId,
      messageId: assistantId,
    })
    this.emit({
      type: "turn/completed",
      sessionId: session.sessionId,
      folderId: session.folderId,
      turnId,
    })
  }

  async interrupt(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.emit({
      type: "marker",
      sessionId,
      folderId: session.folderId,
      marker: {
        id: `interrupt-${Date.now()}`,
        variant: "status",
        text: "Turn interrupted",
        createdAt: Date.now(),
      },
    })
    this.emit({
      type: "turn/completed",
      sessionId,
      folderId: session.folderId,
      turnId: `turn-${session.turnCounter}`,
    })
  }

  async respondApproval(_req: AgentRespondApprovalRequest): Promise<void> {
    // Stub — real adapters will forward to CLI
  }

  private emit(event: AgentEvent): void {
    this.options.onEvent(event)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
