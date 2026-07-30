import {
  type AgentCatalogState,
  type AgentMessage,
  type AgentPermissionRequest,
  type AgentThread,
  type AgentTimelineItem,
  type AgentUserInputRequest,
  type OrchestrationCommand,
  type ProviderRuntimeEvent,
  MAX_BUFFERED_ASSISTANT_CHARS,
  PROVIDER_SEND_TURN_MAX_CHARS,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  buildWorkspaceSnapshot,
  defaultAgentDriverId,
  newAgentThread,
  normalizeAgentId,
} from "@gharargah/agents"
import { AgentStore } from "../persistence/store.js"
import { createAdapter, defaultProviderInstances } from "../provider/registry.js"
import { globalAcpPool } from "../provider/acp-pool.js"
import {
  agentBinaryReady,
  listCachedModels,
  refreshProviderModels,
} from "../provider/model-discovery.js"
import { coerceAssistantText } from "@gharargah/agents"
import { logTurnMetric } from "../metrics.js"
import {
  AgentCommandError,
  ApprovalBlockedError,
  ThreadNotFoundError,
  TurnAlreadyRunningError,
} from "../effect/errors.js"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export type OrchEventSink = {
  threadUpdated: (thread: AgentThread) => void
  threadDelta: (delta: {
    workspaceRootUri: string
    threadId: string
    updatedAt: string
    status: AgentThread["status"]
    lastError: string | null
    messageId: string
    text: string
    streaming: boolean
  }) => void
  structuredDelta: (delta: {
    workspaceRootUri: string
    threadId: string
    sequence: number
    updatedAt: string
    created?: AgentTimelineItem[]
    updated?: AgentTimelineItem[]
    status?: AgentThread["status"]
    pendingPermissions?: AgentPermissionRequest[]
    pendingUserInputs?: AgentUserInputRequest[]
    lastError?: string | null
    connection?: AgentThread["connection"]
    plan?: AgentThread["plan"]
    usage?: AgentThread["usage"]
    availableCommands?: AgentThread["availableCommands"]
  }) => void
  permissionRequest: (payload: {
    workspaceRootUri: string
    workspaceRootPath: string
    threadId: string
    request: AgentPermissionRequest
  }) => void
}

type ActiveTurn = {
  turnId: string
  abort: AbortController
  permissionWaiters: Map<
    string,
    {
      resolve: (v: {
        optionId?: string
        decision?: string
        approvalDecision?: string
      }) => void
    }
  >
  userInputWaiters: Map<string, { resolve: (v: unknown) => void }>
}

function nowIso(): string {
  return new Date().toISOString()
}

function hasOpenApprovals(thread: AgentThread): boolean {
  const perms = thread.pendingPermissions ?? []
  const inputs = thread.pendingUserInputs ?? []
  return (
    perms.some(p => !p.status || p.status === "pending" || p.status === "submitting") ||
    inputs.some(p => !p.status || p.status === "pending" || p.status === "submitting")
  )
}

type CatalogDriver = {
  id: string
  kind: "cli" | "acp" | "native"
  status: "ready" | "unavailable" | "pending"
  message: string | null
  degraded?: boolean
}

function driverProbe(agentId: string): {
  status: CatalogDriver["status"]
  message: string | null
} {
  if (agentBinaryReady(agentId)) return { status: "ready", message: null }
  const hint =
    agentId === "cursor"
      ? "cursor-agent not found on PATH"
      : `${agentId} binary not found on PATH`
  return { status: "unavailable", message: hint }
}

function catalogDriversForAgent(agentId: string): CatalogDriver[] {
  const probe = driverProbe(agentId)
  switch (agentId) {
    case "codex":
      return [
        { id: "codex:cli", kind: "cli", status: probe.status, message: probe.message },
        { id: "codex:app-server", kind: "native", status: probe.status, message: probe.message },
        { id: "codex:acp", kind: "acp", status: probe.status, message: probe.message },
      ]
    case "claude":
      return [
        { id: "claude:cli", kind: "cli", status: probe.status, message: probe.message },
        { id: "claude:sdk", kind: "native", status: probe.status, message: probe.message },
        { id: "claude:acp", kind: "acp", status: probe.status, message: probe.message },
      ]
    case "opencode":
      return [
        { id: "opencode:cli", kind: "cli", status: probe.status, message: probe.message },
        { id: "opencode:sdk", kind: "native", status: probe.status, message: probe.message },
        { id: "opencode:acp", kind: "acp", status: probe.status, message: probe.message },
      ]
    case "cursor":
      return [
        {
          id: "cursor:cli",
          kind: "cli",
          status: probe.status,
          message: probe.message,
          degraded: true,
        },
        { id: "cursor:acp", kind: "acp", status: probe.status, message: probe.message },
      ]
    case "grok":
      return [{ id: "grok:acp", kind: "acp", status: probe.status, message: probe.message }]
    default:
      return [
        {
          id: defaultAgentDriverId(agentId),
          kind: defaultAgentDriverId(agentId).endsWith(":acp") ? "acp" : "native",
          status: probe.status,
          message: probe.message,
        },
      ]
  }
}

export class OrchestrationEngine {
  private turns = new Map<string, ActiveTurn>()
  private threadLocks = new Map<string, Promise<void>>()
  private seq = new Map<string, number>()
  private adapters = new Map<string, ReturnType<typeof createAdapter>>()

  constructor(
    private readonly sink: OrchEventSink,
    private readonly store: AgentStore = new AgentStore(),
  ) {}

  async dispatch(command: OrchestrationCommand): Promise<unknown> {
    const root =
      "input" in command && command.input && "workspaceRootPath" in command.input
        ? command.input.workspaceRootPath
        : "workspaceRootPath" in command
          ? command.workspaceRootPath
          : null
    if (root && "commandId" in command) {
      const receipt = this.store.getReceipt(root, command.commandId)
      if (receipt !== null) return receipt
    }

    let result: unknown
    switch (command.type) {
      case "thread.create":
        result = this.createThread(command.input)
        break
      case "thread.turn.start":
        result = await this.startTurn(command.commandId, command.input)
        break
      case "thread.turn.interrupt":
        result = await this.interrupt(command.input)
        break
      case "thread.approval.respond":
        result = await this.resolvePermission(command.input)
        break
      case "thread.userInput.respond":
        result = await this.resolveUserInput(command.input)
        break
      case "thread.archive":
        result = this.setArchived(command.input)
        break
      case "thread.settings.update":
        result = await this.updateSettings(command.input)
        break
      case "thread.settle":
        result = this.settle(command.workspaceRootPath, command.threadId)
        break
      case "thread.snooze":
        result = this.snooze(command.workspaceRootPath, command.threadId)
        break
      case "thread.checkpoint.create":
        result = await this.createCheckpoint(command.input)
        break
      case "thread.checkpoint.revert":
        result = await this.revertCheckpoint(command.input)
        break
      default:
        throw new AgentCommandError({ message: "unknown command" })
    }

    if (root) {
      const threadId =
        result && typeof result === "object" && result && "id" in result
          ? String((result as { id: string }).id)
          : "input" in command && command.input && "threadId" in command.input
            ? String(command.input.threadId)
            : null
      this.store.putReceipt(root, command.commandId, threadId, result)
    }
    return result
  }

  listThreads(workspaceRootUri: string, workspaceRootPath: string) {
    return buildWorkspaceSnapshot(
      workspaceRootUri,
      workspaceRootPath,
      this.store
        .listThreads(workspaceRootPath)
        .map(s => this.store.readThread(workspaceRootPath, s.id))
        .filter((t): t is AgentThread => t !== null),
    )
  }

  readThread(workspaceRootPath: string, threadId: string): AgentThread | null {
    return this.store.readThread(workspaceRootPath, threadId)
  }

  listAgents(): AgentCatalogState {
    const instances = defaultProviderInstances()
    const updatedAt = nowIso()
    return {
      updatedAt,
      shellEnvStatus: "ready",
      agents: instances.map(inst => {
        const agentId = inst.driverKind
        return {
          id: agentId,
          displayName: inst.displayName,
          enabled: inst.enabled,
          activeDriverId: defaultAgentDriverId(agentId),
          drivers: catalogDriversForAgent(agentId),
          models: listCachedModels(agentId),
        }
      }),
    }
  }

  async refreshAgents(providerId?: string): Promise<AgentCatalogState> {
    await refreshProviderModels(providerId)
    return this.listAgents()
  }

  listProviders() {
    const instances = defaultProviderInstances()
    const catalog = this.listAgents()
    const byId = new Map(catalog.agents.map(a => [a.id, a]))
    return {
      updatedAt: catalog.updatedAt,
      providers: instances.map(inst => {
        const agent = byId.get(inst.driverKind)
        const preferred =
          agent?.drivers.find(d => d.id === agent.activeDriverId) ?? agent?.drivers[0]
        return {
          instanceId: inst.instanceId,
          driverKind: inst.driverKind,
          displayName: inst.displayName,
          enabled: inst.enabled,
          status: preferred?.status ?? "unavailable",
          message: preferred?.message,
          models: agent?.models ?? [{ slug: "auto", name: "Auto", shortName: "auto" }],
          continuationGroupKey: inst.continuationGroupKey,
          homePath: inst.homePath ?? null,
        }
      }),
    }
  }

  async refreshProviders(providerId?: string) {
    await this.refreshAgents(providerId)
    return this.listProviders()
  }

  private createThread(input: Parameters<typeof newAgentThread>[0]): AgentThread {
    const thread = newAgentThread(input)
    const instances = defaultProviderInstances()
    const inst = instances.find(i => i.driverKind === normalizeAgentId(thread.agentId))
    if (inst) {
      thread.providerInstanceId = inst.instanceId
    }
    this.store.writeThread(thread.workspaceRootPath, thread)
    this.sink.threadUpdated(thread)
    return thread
  }

  private async withThreadLock<T>(threadId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.threadLocks.get(threadId) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>(r => {
      release = r
    })
    this.threadLocks.set(
      threadId,
      prev.then(() => gate),
    )
    await prev
    try {
      return await fn()
    } finally {
      release()
    }
  }

  private async startTurn(
    commandId: string,
    input: import("@gharargah/agents").SendAgentMessageInput,
  ): Promise<AgentThread> {
    if (input.text.length > PROVIDER_SEND_TURN_MAX_CHARS) {
      throw new AgentCommandError({
        message: `prompt exceeds ${PROVIDER_SEND_TURN_MAX_CHARS} chars`,
      })
    }
    const attachmentCount = (input.images?.length ?? 0) + (input.files?.length ?? 0)
    if (attachmentCount > PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
      throw new AgentCommandError({
        message: `max ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} attachments`,
      })
    }

    return this.withThreadLock(input.threadId, async () => {
      const thread = this.store.readThread(input.workspaceRootPath, input.threadId)
      if (!thread) throw new ThreadNotFoundError({ threadId: input.threadId })
      if (this.turns.has(thread.id)) throw new TurnAlreadyRunningError({ threadId: thread.id })

      const now = nowIso()
      const attachments = [
        ...(input.files ?? []).map(f => ({
          name: f.name,
          mimeType: f.mimeType ?? null,
          path: f.path ?? null,
          kind: "file" as const,
        })),
        ...(input.images ?? []).map(img => ({
          name: img.name ?? "image",
          mimeType: img.mimeType,
          path: null,
          kind: "image" as const,
        })),
      ]
      const userMsg: AgentMessage = {
        id: crypto.randomUUID(),
        role: "user",
        text: input.text,
        createdAt: now,
        updatedAt: now,
        streaming: false,
        ...(attachments.length > 0 ? { attachments } : {}),
      }
      const assistantId = crypto.randomUUID()
      const assistantMsg: AgentMessage = {
        id: assistantId,
        role: "assistant",
        text: "",
        createdAt: now,
        updatedAt: now,
        streaming: true,
      }
      thread.messages = [...thread.messages, userMsg, assistantMsg]
      if (input.agentId) thread.agentId = normalizeAgentId(input.agentId)
      if (input.driverId) thread.driverId = input.driverId
      if (input.model) thread.model = input.model
      thread.status = "running"
      thread.lastError = null
      thread.updatedAt = now
      this.store.writeThread(thread.workspaceRootPath, thread)
      this.sink.threadUpdated(thread)

      const turnId = commandId || crypto.randomUUID()
      const abort = new AbortController()
      const active: ActiveTurn = {
        turnId,
        abort,
        permissionWaiters: new Map(),
        userInputWaiters: new Map(),
      }
      this.turns.set(thread.id, active)

      const driverId = thread.driverId ?? defaultAgentDriverId(thread.agentId)
      let adapter = this.adapters.get(driverId)
      if (!adapter) {
        adapter = createAdapter(driverId)
        this.adapters.set(driverId, adapter)
      }

      const turnStartedAt = Date.now()
      logTurnMetric({
        event: "turn.start",
        threadId: thread.id,
        turnId,
        agentId: thread.agentId,
        driverId,
      })

      let lastFlushLen = 0
      const emit = (event: ProviderRuntimeEvent) => {
        this.applyRuntimeEvent(thread, assistantId, event, active, lastFlushLen, len => {
          lastFlushLen = len
        })
      }

      // Fire and forget turn; return current thread snapshot immediately (streaming via events).
      void adapter
        .startTurn({
          thread: { ...thread },
          turnId,
          input,
          emit,
          signal: abort.signal,
          resolvePermission: permissionId =>
            new Promise(resolve => {
              active.permissionWaiters.set(permissionId, { resolve })
            }),
          resolveUserInput: requestId =>
            new Promise(resolve => {
              active.userInputWaiters.set(requestId, { resolve })
            }),
        })
        .catch(err => {
          emit({
            type: "turn.failed",
            turnId,
            threadId: thread.id,
            error: err instanceof Error ? err.message : String(err),
          })
        })
        .finally(() => {
          logTurnMetric({
            event: "turn.end",
            threadId: thread.id,
            turnId,
            agentId: thread.agentId,
            driverId,
            durationMs: Date.now() - turnStartedAt,
            status: this.store.readThread(thread.workspaceRootPath, thread.id)?.status,
          })
          this.turns.delete(thread.id)
        })

      return this.store.readThread(thread.workspaceRootPath, thread.id) ?? thread
    })
  }

  private applyRuntimeEvent(
    seed: AgentThread,
    assistantId: string,
    event: ProviderRuntimeEvent,
    active: ActiveTurn,
    _lastFlushLen: number,
    setFlushLen: (n: number) => void,
  ): void {
    const thread = this.store.readThread(seed.workspaceRootPath, seed.id) ?? seed
    const nextSeq = (this.seq.get(thread.id) ?? thread.acpSequence ?? 0) + 1
    this.seq.set(thread.id, nextSeq)
    this.store.appendEvent(thread.workspaceRootPath, thread.id, nextSeq, event)

    switch (event.type) {
      case "content.delta": {
        const text = coerceAssistantText(event.text)
        const msgs = thread.messages.map(m =>
          m.id === event.messageId || m.id === assistantId
            ? { ...m, text, updatedAt: nowIso(), streaming: true }
            : m,
        )
        thread.messages = msgs
        thread.status = "running"
        thread.updatedAt = nowIso()
        if (text.length - _lastFlushLen >= MAX_BUFFERED_ASSISTANT_CHARS) {
          this.store.writeThread(thread.workspaceRootPath, thread)
          setFlushLen(text.length)
        }
        this.sink.threadDelta({
          workspaceRootUri: thread.workspaceRootUri,
          threadId: thread.id,
          updatedAt: thread.updatedAt,
          status: thread.status,
          lastError: null,
          messageId: event.messageId,
          text,
          streaming: true,
        })
        break
      }
      case "content.done": {
        const text = coerceAssistantText(event.text)
        const msgs = thread.messages.map(m =>
          m.id === event.messageId || m.id === assistantId
            ? { ...m, text, updatedAt: nowIso(), streaming: false }
            : m,
        )
        thread.messages = msgs
        thread.acpSequence = nextSeq
        thread.updatedAt = nowIso()
        this.store.writeThread(thread.workspaceRootPath, thread)
        this.sink.threadUpdated(thread)
        break
      }
      case "request.permission": {
        thread.pendingPermissions = [event.request]
        thread.status = "waiting_for_permission"
        thread.acpSequence = nextSeq
        thread.updatedAt = nowIso()
        const item: AgentTimelineItem = {
          id: event.request.id,
          kind: "permission",
          permission: event.request,
          createdAt: event.request.createdAt,
        }
        thread.timeline = [...(thread.timeline ?? []), item]
        this.store.writeThread(thread.workspaceRootPath, thread)
        this.sink.permissionRequest({
          workspaceRootUri: thread.workspaceRootUri,
          workspaceRootPath: thread.workspaceRootPath,
          threadId: thread.id,
          request: event.request,
        })
        this.sink.structuredDelta({
          workspaceRootUri: thread.workspaceRootUri,
          threadId: thread.id,
          sequence: nextSeq,
          updatedAt: thread.updatedAt,
          created: [item],
          status: thread.status,
          pendingPermissions: thread.pendingPermissions,
        })
        this.sink.threadUpdated(thread)
        break
      }
      case "request.userInput": {
        thread.pendingUserInputs = [event.request]
        thread.status = "waiting_for_permission"
        thread.acpSequence = nextSeq
        thread.updatedAt = nowIso()
        const item: AgentTimelineItem = {
          id: event.request.id,
          kind: "user_input",
          userInput: event.request,
          createdAt: event.request.createdAt,
        }
        thread.timeline = [...(thread.timeline ?? []), item]
        this.store.writeThread(thread.workspaceRootPath, thread)
        this.sink.structuredDelta({
          workspaceRootUri: thread.workspaceRootUri,
          threadId: thread.id,
          sequence: nextSeq,
          updatedAt: thread.updatedAt,
          created: [item],
          status: thread.status,
          pendingUserInputs: thread.pendingUserInputs,
        })
        this.sink.threadUpdated(thread)
        break
      }
      case "commands.update": {
        thread.availableCommands = [...event.commands]
        thread.acpSequence = nextSeq
        thread.updatedAt = nowIso()
        this.store.writeThread(thread.workspaceRootPath, thread)
        this.sink.structuredDelta({
          workspaceRootUri: thread.workspaceRootUri,
          threadId: thread.id,
          sequence: nextSeq,
          updatedAt: thread.updatedAt,
          availableCommands: thread.availableCommands,
        })
        this.sink.threadUpdated(thread)
        break
      }
      case "tool.upsert": {
        const item: AgentTimelineItem = {
          id: event.toolCallId,
          kind: "tool_call",
          toolCall: {
            id: event.toolCallId,
            name: event.name,
            status: event.status,
            summary: event.summary,
            input: event.input,
            output: event.output,
            error: event.error,
            kind: "read",
          },
          createdAt: nowIso(),
        }
        const timeline = [...(thread.timeline ?? [])]
        const idx = timeline.findIndex(t => t.id === event.toolCallId)
        if (idx >= 0) {
          const prev = timeline[idx]
          if (prev?.kind === "tool_call") {
            item.toolCall = {
              ...prev.toolCall,
              ...item.toolCall,
              name: event.name || prev.toolCall.name,
              summary: event.summary ?? prev.toolCall.summary,
              input: event.input ?? prev.toolCall.input,
              output: event.output ?? prev.toolCall.output,
            }
          }
          timeline[idx] = item
        } else timeline.push(item)
        thread.timeline = timeline
        thread.acpSequence = nextSeq
        thread.updatedAt = nowIso()
        this.store.writeThread(thread.workspaceRootPath, thread)
        this.sink.structuredDelta({
          workspaceRootUri: thread.workspaceRootUri,
          threadId: thread.id,
          sequence: nextSeq,
          updatedAt: thread.updatedAt,
          created: idx < 0 ? [item] : undefined,
          updated: idx >= 0 ? [item] : undefined,
          status: thread.status,
        })
        this.sink.threadUpdated(thread)
        break
      }
      case "thought.delta": {
        const thoughtId = event.thoughtId ?? `thought-${thread.id}`
        const timeline = [...(thread.timeline ?? [])]
        const idx = timeline.findIndex(t => t.id === thoughtId && t.kind === "thought")
        const prevText =
          idx >= 0 && timeline[idx]?.kind === "thought" ? (timeline[idx] as { text: string }).text : ""
        const item: AgentTimelineItem = {
          id: thoughtId,
          kind: "thought",
          text: prevText + event.text,
          createdAt: nowIso(),
        }
        if (idx >= 0) timeline[idx] = item
        else timeline.push(item)
        thread.timeline = timeline
        thread.acpSequence = nextSeq
        thread.updatedAt = nowIso()
        this.store.writeThread(thread.workspaceRootPath, thread)
        this.sink.structuredDelta({
          workspaceRootUri: thread.workspaceRootUri,
          threadId: thread.id,
          sequence: nextSeq,
          updatedAt: thread.updatedAt,
          created: idx < 0 ? [item] : undefined,
          updated: idx >= 0 ? [item] : undefined,
          status: thread.status,
        })
        break
      }
      case "plan.update": {
        thread.plan = event.plan
        const item: AgentTimelineItem = {
          id: event.plan.id,
          kind: "plan",
          plan: event.plan,
          createdAt: nowIso(),
        }
        const timeline = [...(thread.timeline ?? [])]
        const idx = timeline.findIndex(t => t.kind === "plan")
        if (idx >= 0) timeline[idx] = item
        else timeline.push(item)
        thread.timeline = timeline
        thread.acpSequence = nextSeq
        thread.updatedAt = nowIso()
        this.store.writeThread(thread.workspaceRootPath, thread)
        this.sink.structuredDelta({
          workspaceRootUri: thread.workspaceRootUri,
          threadId: thread.id,
          sequence: nextSeq,
          updatedAt: thread.updatedAt,
          created: idx < 0 ? [item] : undefined,
          updated: idx >= 0 ? [item] : undefined,
          status: thread.status,
          plan: event.plan,
        })
        this.sink.threadUpdated(thread)
        break
      }
      case "usage.update": {
        thread.usage = event.usage
        const item: AgentTimelineItem = {
          id: `usage-${thread.id}`,
          kind: "usage",
          usage: event.usage,
          createdAt: nowIso(),
        }
        const timeline = [...(thread.timeline ?? [])]
        const idx = timeline.findIndex(t => t.kind === "usage")
        if (idx >= 0) timeline[idx] = item
        else timeline.push(item)
        thread.timeline = timeline
        thread.acpSequence = nextSeq
        thread.updatedAt = nowIso()
        this.store.writeThread(thread.workspaceRootPath, thread)
        this.sink.structuredDelta({
          workspaceRootUri: thread.workspaceRootUri,
          threadId: thread.id,
          sequence: nextSeq,
          updatedAt: thread.updatedAt,
          created: idx < 0 ? [item] : undefined,
          updated: idx >= 0 ? [item] : undefined,
          status: thread.status,
          usage: event.usage,
        })
        this.sink.threadUpdated(thread)
        break
      }
      case "session.bound": {
        if (event.acpSessionId) thread.acpSessionId = event.acpSessionId
        if (event.providerSessionId) thread.providerSessionId = event.providerSessionId
        if (event.providerTransport) thread.providerTransport = event.providerTransport
        if (event.providerInstanceId) thread.providerInstanceId = event.providerInstanceId
        if (event.sessionModes !== undefined) thread.sessionModes = event.sessionModes
        if (event.configOptions !== undefined) thread.configOptions = event.configOptions
        if (event.discoveredModels !== undefined) {
          thread.discoveredModels = event.discoveredModels
        }
        if (event.model !== undefined && event.model) thread.model = event.model
        this.store.saveProviderSession(thread.workspaceRootPath, thread.id, {
          instanceId: event.providerInstanceId,
          resumeCursor: { acpSessionId: event.acpSessionId, providerSessionId: event.providerSessionId },
          transport: event.providerTransport,
        })
        thread.updatedAt = nowIso()
        this.store.writeThread(thread.workspaceRootPath, thread)
        this.sink.threadUpdated(thread)
        break
      }
      case "connection.update": {
        thread.connection = event.connection
        thread.acpSequence = nextSeq
        thread.updatedAt = nowIso()
        this.store.writeThread(thread.workspaceRootPath, thread)
        this.sink.structuredDelta({
          workspaceRootUri: thread.workspaceRootUri,
          threadId: thread.id,
          sequence: nextSeq,
          updatedAt: thread.updatedAt,
          connection: event.connection,
        })
        break
      }
      case "turn.completed": {
        thread.status = "idle"
        thread.pendingPermissions = []
        thread.acpSequence = nextSeq
        thread.updatedAt = nowIso()
        thread.messages = thread.messages.map(m =>
          m.streaming ? { ...m, streaming: false, updatedAt: nowIso() } : m,
        )
        this.store.writeThread(thread.workspaceRootPath, thread)
        this.sink.threadUpdated(thread)
        break
      }
      case "turn.cancelled": {
        thread.status = "cancelled"
        thread.acpSequence = nextSeq
        thread.updatedAt = nowIso()
        thread.messages = thread.messages.map(m =>
          m.streaming ? { ...m, streaming: false, updatedAt: nowIso() } : m,
        )
        this.store.writeThread(thread.workspaceRootPath, thread)
        this.sink.threadUpdated(thread)
        break
      }
      case "turn.failed": {
        thread.status = "error"
        thread.lastError = event.error
        thread.acpSequence = nextSeq
        thread.updatedAt = nowIso()
        thread.messages = thread.messages.map(m =>
          m.streaming ? { ...m, streaming: false, updatedAt: nowIso() } : m,
        )
        this.store.writeThread(thread.workspaceRootPath, thread)
        this.sink.threadUpdated(thread)
        break
      }
      default:
        break
    }
  }

  private async interrupt(
    input: import("@gharargah/agents").InterruptAgentTurnInput,
  ): Promise<AgentThread | null> {
    const active = this.turns.get(input.threadId)
    active?.abort.abort()
    const thread = this.store.readThread(input.workspaceRootPath, input.threadId)
    if (!thread) return null
    thread.status = "cancelling"
    thread.updatedAt = nowIso()
    this.store.writeThread(thread.workspaceRootPath, thread)
    this.sink.threadUpdated(thread)
    const driverId = thread.driverId ?? defaultAgentDriverId(thread.agentId)
    await this.adapters.get(driverId)?.interrupt?.(thread.id)
    return this.store.readThread(input.workspaceRootPath, input.threadId)
  }

  private async resolvePermission(
    input: import("@gharargah/agents").ResolveAgentPermissionInput,
  ): Promise<void> {
    const active = this.turns.get(input.threadId)
    const waiter = active?.permissionWaiters.get(input.permissionId)
    if (waiter) {
      waiter.resolve({
        optionId: input.optionId,
        decision: input.decision,
        approvalDecision: input.approvalDecision,
      })
      active?.permissionWaiters.delete(input.permissionId)
    }
    const thread = this.store.readThread(input.workspaceRootPath, input.threadId)
    if (!thread) return
    thread.pendingPermissions = (thread.pendingPermissions ?? []).filter(
      p => p.id !== input.permissionId,
    )
    if (
      input.approvalDecision === "acceptForSession" ||
      input.decision === "allow_always"
    ) {
      const rules = [...(thread.permissionRules ?? [])]
      rules.push({
        scope: "*",
        optionId: input.optionId ?? "allow_always",
      })
      thread.permissionRules = rules
    }
    thread.status = active ? "running" : "idle"
    thread.updatedAt = nowIso()
    // Keep sequence monotonic with any prior structured deltas so UI merge accepts this snapshot.
    thread.acpSequence = Math.max(thread.acpSequence ?? 0, this.seq.get(thread.id) ?? 0)
    this.store.writeThread(thread.workspaceRootPath, thread)
    this.sink.threadUpdated(thread)
  }

  private async resolveUserInput(
    input: import("@gharargah/agents").ResolveAgentUserInputInput,
  ): Promise<void> {
    const active = this.turns.get(input.threadId)
    active?.userInputWaiters.get(input.requestId)?.resolve(input)
    active?.userInputWaiters.delete(input.requestId)
    const thread = this.store.readThread(input.workspaceRootPath, input.threadId)
    if (!thread) return
    thread.pendingUserInputs = (thread.pendingUserInputs ?? []).filter(
      p => p.id !== input.requestId,
    )
    thread.status = active ? "running" : "idle"
    thread.acpSequence = Math.max(thread.acpSequence ?? 0, this.seq.get(thread.id) ?? 0)
    thread.updatedAt = nowIso()
    this.store.writeThread(thread.workspaceRootPath, thread)
    this.sink.threadUpdated(thread)
  }

  private setArchived(
    input: import("@gharargah/agents").SetAgentThreadArchivedInput,
  ): AgentThread | null {
    const thread = this.store.readThread(input.workspaceRootPath, input.threadId)
    if (!thread) return null
    if (input.archived && hasOpenApprovals(thread)) {
      throw new ApprovalBlockedError({ operation: "archive", threadId: thread.id })
    }
    thread.archivedAt = input.archived ? nowIso() : null
    thread.updatedAt = nowIso()
    this.store.writeThread(thread.workspaceRootPath, thread)
    this.sink.threadUpdated(thread)
    return thread
  }

  private settle(workspaceRootPath: string, threadId: string): AgentThread | null {
    const thread = this.store.readThread(workspaceRootPath, threadId)
    if (!thread) return null
    if (hasOpenApprovals(thread)) {
      throw new ApprovalBlockedError({ operation: "settle", threadId: thread.id })
    }
    thread.status = "idle"
    thread.activity = "settled"
    thread.updatedAt = nowIso()
    this.store.writeThread(thread.workspaceRootPath, thread)
    this.sink.threadUpdated(thread)
    return thread
  }

  private snooze(workspaceRootPath: string, threadId: string): AgentThread | null {
    const thread = this.store.readThread(workspaceRootPath, threadId)
    if (!thread) return null
    if (hasOpenApprovals(thread)) {
      throw new ApprovalBlockedError({ operation: "snooze", threadId: thread.id })
    }
    thread.status = "idle"
    thread.activity = "snoozed"
    thread.updatedAt = nowIso()
    this.store.writeThread(thread.workspaceRootPath, thread)
    this.sink.threadUpdated(thread)
    return thread
  }

  private async updateSettings(
    input: import("@gharargah/agents").UpdateAgentThreadSettingsInput,
  ): Promise<AgentThread | null> {
    const thread = this.store.readThread(input.workspaceRootPath, input.threadId)
    if (!thread) return null
    if (input.agentId !== undefined) thread.agentId = normalizeAgentId(input.agentId)
    if (input.driverId !== undefined) thread.driverId = input.driverId
    if (input.model !== undefined) thread.model = input.model
    if (input.runtimeMode !== undefined) thread.runtimeMode = input.runtimeMode
    if (input.interactionMode !== undefined) thread.interactionMode = input.interactionMode
    thread.updatedAt = nowIso()
    this.store.writeThread(thread.workspaceRootPath, thread)
    this.sink.threadUpdated(thread)

    const driverId = thread.driverId ?? defaultAgentDriverId(thread.agentId)
    const instance = thread.providerInstanceId ?? thread.agentId ?? "default"
    const key = `${driverId}:${instance}:${thread.workspaceRootPath}`
    const client = thread.acpSessionId ? globalAcpPool.get(key) : null

    // Propagate plan/ask/implement → ACP session/set_mode when a live client exists.
    if (input.interactionMode && client && thread.acpSessionId) {
      const modeId =
        input.interactionMode === "plan"
          ? "plan"
          : input.interactionMode === "ask"
            ? "ask"
            : "agent"
      void client.setSessionMode(thread.acpSessionId, modeId).catch(() => undefined)
    }

    // Live model switch: prefer session/set_model, fall back to set_config_option("model").
    if (input.model !== undefined && input.model && client && thread.acpSessionId) {
      const model = input.model
      try {
        await client.setSessionModel(thread.acpSessionId, model)
      } catch {
        await client.setConfigOption(thread.acpSessionId, "model", model).catch(() => undefined)
      }
    }
    return thread
  }

  private async createCheckpoint(input: {
    workspaceRootPath: string
    threadId: string
    label?: string
    turnId?: string
  }): Promise<{ id: string }> {
    const thread = this.store.readThread(input.workspaceRootPath, input.threadId)
    if (!thread) throw new ThreadNotFoundError({ threadId: input.threadId })
    const id = crypto.randomUUID()
    const label = input.label ?? `checkpoint-${new Date().toISOString()}`
    // Record HEAD only — never `git stash push` (destructive to dirty trees).
    // Full tree snapshots (t3 CheckpointReactor) remain a follow-up.
    let gitRef: string | null = null
    try {
      const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: input.workspaceRootPath,
      })
      gitRef = stdout.trim()
    } catch {
      /* not a git repo — transcript checkpoint only */
    }
    const checkpoints = [
      ...(thread.checkpoints ?? []),
      {
        id,
        createdAt: nowIso(),
        label: gitRef ? `${label} (${gitRef.slice(0, 7)})` : label,
        messageCount: thread.messages.length,
        timelineCount: thread.timeline?.length ?? 0,
        turnId: input.turnId ?? null,
        gitStashMessage: null,
        gitRef,
      },
    ]
    thread.checkpoints = checkpoints
    thread.updatedAt = nowIso()
    this.store.writeThread(thread.workspaceRootPath, thread)
    this.sink.threadUpdated(thread)
    return { id }
  }

  private async revertCheckpoint(input: {
    workspaceRootPath: string
    threadId: string
    checkpointId: string
  }): Promise<AgentThread> {
    const thread = this.store.readThread(input.workspaceRootPath, input.threadId)
    if (!thread) throw new ThreadNotFoundError({ threadId: input.threadId })
    const cp = (thread.checkpoints ?? []).find(c => c.id === input.checkpointId)
    if (!cp) {
      throw new AgentCommandError({ message: `checkpoint not found: ${input.checkpointId}` })
    }
    thread.messages = thread.messages.slice(0, cp.messageCount)
    if (thread.timeline) thread.timeline = thread.timeline.slice(0, cp.timelineCount)
    // Legacy checkpoints may still carry gitStashMessage from older servers.
    if (cp.gitStashMessage) {
      try {
        const { stdout } = await execFileAsync("git", ["stash", "list", "--format=%gd:%s"], {
          cwd: input.workspaceRootPath,
        })
        const line = stdout
          .split("\n")
          .map(l => l.trim())
          .find(l => l.includes(cp.gitStashMessage!))
        const stashRef = line?.split(":")[0]
        if (stashRef) {
          await execFileAsync("git", ["stash", "apply", stashRef], {
            cwd: input.workspaceRootPath,
          })
        }
      } catch {
        /* stash missing or conflict — transcript still reverted */
      }
    }
    thread.updatedAt = nowIso()
    this.store.writeThread(thread.workspaceRootPath, thread)
    this.sink.threadUpdated(thread)
    return thread
  }

  close(): void {
    this.store.close()
    void globalAcpPool.closeAll()
  }
}
