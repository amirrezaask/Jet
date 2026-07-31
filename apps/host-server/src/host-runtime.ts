import {
  PerfHost,
  setLspCrashHandler,
  stopAllLspSessions,
  TerminalHost,
} from "@gharargah/node-host"
import type { NotificationStreamEvent } from "@gharargah/shared"
import type { AgentProvider } from "@gharargah/agents"
import type { HostConfig } from "./config.js"
import type { EventHub } from "./events.js"
import {
  NotificationService,
  parseOscStreamChunk,
} from "./notifications/index.js"
import {
  AgentTelemetryService,
  listQueuedHooks,
  removeQueuedHook,
  type AgentSnapshotStreamEvent,
} from "./agents/index.js"
import type { ProjectDatabase } from "./persistence.js"
import { WorkspaceHost } from "./workspace.js"

export type HostRuntime = {
  config: HostConfig
  events: EventHub
  db: ProjectDatabase
  terminal: TerminalHost
  workspace: WorkspaceHost
  perf: PerfHost
  homeDir: string
  notifications: NotificationService
  agents: AgentTelemetryService
}

function asAgentProvider(value: string | null | undefined): AgentProvider | null {
  if (
    value === "claude" ||
    value === "codex" ||
    value === "cursor" ||
    value === "opencode" ||
    value === "grok"
  ) {
    return value
  }
  return null
}

export function createRuntime(
  config: HostConfig,
  events: EventHub,
  db: ProjectDatabase,
  terminal: TerminalHost = new TerminalHost(),
  options?: {
    /** When set, notification stream events go here (e.g. PubSub → EventHub bridge). */
    emitNotification?: (event: NotificationStreamEvent) => void
  },
): HostRuntime {
  const terminalOscBuffers = new Map<string, string>()
  const emitNotification =
    options?.emitNotification ??
    ((streamEvent: NotificationStreamEvent) => {
      events.emit("notifications:event", [streamEvent])
    })
  const notifications = new NotificationService(db.raw(), emitNotification)

  const emitAgent = (streamEvent: AgentSnapshotStreamEvent) => {
    events.emit("agents:event", [streamEvent])
  }
  const agents = new AgentTelemetryService(db.raw(), notifications, emitAgent)

  terminal.setEmit((channel, args) => {
    events.emit(channel, args)
    if (channel === "terminal:data") {
      const ptyId = String(args[0] ?? "")
      const data = String(args[1] ?? "")
      handleTerminalOsc(notifications, agents, terminalOscBuffers, ptyId, data)
    } else if (channel === "terminal:exit") {
      const ptyId = String(args[0] ?? "")
      terminalOscBuffers.delete(ptyId)
      const exitCode = typeof args[1] === "number" ? args[1] : Number(args[1] ?? 0)
      handleTerminalExit(notifications, agents, ptyId, exitCode)
    }
  })

  const workspace = new WorkspaceHost()
  const homeDir = process.env.HOME ?? config.allowedRoots[0] ?? ""
  const runtime: HostRuntime = {
    config,
    events,
    db,
    terminal,
    workspace,
    perf: new PerfHost(homeDir, Date.now()),
    homeDir,
    notifications,
    agents,
  }
  setLspCrashHandler(id => events.emit("lsp:crashed", [id]))

  // Drain offline hook queue from previous host downtime.
  drainHookQueue(agents, config.dataDir)

  return runtime
}

function drainHookQueue(agents: AgentTelemetryService, dataDir: string): void {
  for (const item of listQueuedHooks(dataDir)) {
    const provider = asAgentProvider(item.meta.provider)
    if (!provider || !item.meta.sessionId) {
      removeQueuedHook(item.file)
      continue
    }
    try {
      agents.ingestNative(item.payload, {
        provider,
        sessionId: item.meta.sessionId,
      })
      removeQueuedHook(item.file)
    } catch {
      /* leave for next startup */
    }
  }
}

function handleTerminalOsc(
  notifications: NotificationService,
  agents: AgentTelemetryService,
  buffers: Map<string, string>,
  ptyId: string,
  data: string,
): void {
  const result = parseOscStreamChunk(buffers.get(ptyId) ?? "", data)
  if (result.buffered) buffers.set(ptyId, result.buffered)
  else buffers.delete(ptyId)
  const parsed = result.notifications
  if (parsed.length === 0) return
  const binding = notifications.bindingForPty(ptyId)
  for (const item of parsed) {
    const provider = asAgentProvider(binding?.provider ?? item.provider ?? null)
    if (provider && binding?.sessionId) {
      agents.ingestNative(
        {
          type: item.type,
          title: item.title,
          message: item.message,
          providerEvent: item.type,
          providerSessionId: item.providerSessionId,
        },
        {
          provider,
          sessionId: binding.sessionId,
          processId: ptyId,
          projectId: binding.projectId ?? undefined,
          projectName: binding.projectName ?? undefined,
          sessionTitle: binding.sessionTitle ?? undefined,
        },
      )
      continue
    }
    notifications.ingest({
      ...item,
      sessionId: binding?.sessionId ?? null,
      projectId: binding?.projectId ?? null,
      projectName: binding?.projectName ?? null,
      sessionTitle: binding?.sessionTitle ?? null,
      provider: binding?.provider ?? item.provider ?? null,
    })
  }
}

function handleTerminalExit(
  notifications: NotificationService,
  agents: AgentTelemetryService,
  ptyId: string,
  exitCode: number,
): void {
  const binding = notifications.bindingForPty(ptyId)
  const provider = asAgentProvider(binding?.provider ?? null)
  if (provider && binding?.sessionId) {
    agents.onProcessExited({
      provider,
      sessionId: binding.sessionId,
      processId: ptyId,
      exitCode,
      expectedExit: exitCode === 0,
      projectId: binding.projectId ?? undefined,
    })
    return
  }
  if (exitCode === 0) return
  const providerLabel = binding?.provider
    ? binding.provider.charAt(0).toUpperCase() + binding.provider.slice(1)
    : "Process"
  notifications.ingest({
    source: "process",
    type: exitCode > 0 ? "failed" : "process-exited",
    title: `${providerLabel} exited with code ${exitCode}`,
    message: binding?.sessionTitle
      ? `Session “${binding.sessionTitle}” ended unexpectedly.`
      : "Session process ended unexpectedly.",
    sessionId: binding?.sessionId ?? null,
    projectId: binding?.projectId ?? null,
    projectName: binding?.projectName ?? null,
    sessionTitle: binding?.sessionTitle ?? null,
    provider: binding?.provider ?? null,
    eventId: `exit:${ptyId}:${exitCode}`,
    metadata: { exitCode, ptyId },
  })
}

export function shutdownRuntime(runtime: HostRuntime): void {
  runtime.events.emit("server:shuttingDown", [])
  runtime.workspace.stopAll()
  runtime.terminal.stopAll()
  stopAllLspSessions()
}
