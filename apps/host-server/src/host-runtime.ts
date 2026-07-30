import {
  PerfHost,
  setLspCrashHandler,
  stopAllLspSessions,
  TerminalHost,
} from "@gharargah/node-host"
import type { NotificationStreamEvent } from "@gharargah/shared"
import type { HostConfig } from "./config.js"
import type { EventHub } from "./events.js"
import {
  NotificationService,
  parseOscStreamChunk,
} from "./notifications/index.js"
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

  terminal.setEmit((channel, args) => {
    events.emit(channel, args)
    if (channel === "terminal:data") {
      const ptyId = String(args[0] ?? "")
      const data = String(args[1] ?? "")
      handleTerminalOsc(notifications, terminalOscBuffers, ptyId, data)
    } else if (channel === "terminal:exit") {
      const ptyId = String(args[0] ?? "")
      terminalOscBuffers.delete(ptyId)
      const exitCode = typeof args[1] === "number" ? args[1] : Number(args[1] ?? 0)
      handleTerminalExit(notifications, ptyId, exitCode)
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
  }
  setLspCrashHandler(id => events.emit("lsp:crashed", [id]))
  return runtime
}

function handleTerminalOsc(
  notifications: NotificationService,
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
  ptyId: string,
  exitCode: number,
): void {
  const binding = notifications.bindingForPty(ptyId)
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
