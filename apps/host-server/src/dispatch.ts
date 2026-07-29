import {
  fileSearch,
  gitBranch,
  gitBranches,
  gitCheckout,
  gitCommitWithBody,
  gitDiff,
  gitDiscard,
  gitFetch,
  gitHistory,
  gitIsRepo,
  gitPull,
  gitPush,
  gitStage,
  gitStatus,
  gitSummary,
  gitUnstage,
  gitShow,
  isSearchScanReady,
  listProjectFiles,
  loadGlobalGharargahrcScanRoots,
  openInApp,
  revealInFolder,
  PerfHost,
  projectSearch,
  readDir,
  readFile,
  setLspCrashHandler,
  spawnTask,
  startLspSession,
  stat,
  stopAllLspSessions,
  stopLspSession,
  TerminalHost,
  trackFileAccess,
  writeFile,
  writeTempDrop,
  type TerminalLaunch,
} from "@gharargah/node-host"
import type {
  BindNotificationSessionRequest,
  IngestNotificationRequest,
  ListNotificationsRequest,
  MarkAllNotificationsReadRequest,
  NotificationPreferences,
  NotificationStreamEvent,
} from "@gharargah/shared"
import type { EventHub } from "./events.js"
import type { ProjectDatabase } from "./persistence.js"
import type { HostConfig } from "./config.js"
import { WorkspaceHost } from "./workspace.js"
import {
  NotificationService,
  parseOscStreamChunk,
  normalizeHookEventName,
} from "./notifications/index.js"

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

export function createRuntime(config: HostConfig, events: EventHub, db: ProjectDatabase): HostRuntime {
  const terminal = new TerminalHost()
  const terminalOscBuffers = new Map<string, string>()
  const notifications = new NotificationService(db.raw(), (streamEvent: NotificationStreamEvent) => {
    events.emit("notifications:event", [streamEvent])
  })

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
      // Terminal output is untrusted. A sequence may add semantic event data,
      // but it must never escape the PTY's authoritative session binding.
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

export async function dispatch(
  runtime: HostRuntime,
  channel: string,
  args: unknown[],
  clientId: string,
): Promise<unknown> {
  if (channel.startsWith("agents:")) {
    throw new Error(
      "agents:* moved to Effect agent-server (ws://127.0.0.1:4751/agents); host no longer handles agents",
    )
  }
  if (channel === "ui:syncNativeChrome") return null
  if (channel === "fs:showOpenFolderDialog" || channel === "fs:showSaveFileDialog") return null
  if (channel === "gharargah:getLaunchConfig") return runtime.config.launchConfig
  if (channel === "gharargah:getHomeDir") return runtime.homeDir
  if (channel === "gharargah:loadGlobalGharargahrcScanRoots") {
    return loadGlobalGharargahrcScanRoots(runtime.homeDir)
  }

  if (channel.startsWith("notifications:")) {
    return handleNotifications(runtime, channel, args)
  }
  if (channel.startsWith("fs:")) return handleFs(channel, args)
  if (channel.startsWith("git:")) return handleGit(channel, args)
  if (channel.startsWith("search:")) return handleSearch(runtime, channel, args)
  if (channel.startsWith("workspace:")) return handleWorkspace(runtime, channel, args)
  if (channel.startsWith("lsp:")) return handleLsp(runtime, channel, args)
  if (channel.startsWith("terminal:")) return handleTerminal(runtime, channel, args, clientId)
  if (channel.startsWith("shell:")) return handleShell(channel, args)
  if (channel.startsWith("tasks:")) return handleTasks(channel, args)
  if (channel.startsWith("perf:")) return handlePerf(runtime, channel, args)

  throw new Error(`unknown host channel: ${channel}`)
}

function handleNotifications(
  runtime: HostRuntime,
  channel: string,
  args: unknown[],
): unknown {
  const n = runtime.notifications
  switch (channel) {
    case "notifications:list":
      return n.list((args[0] as ListNotificationsRequest | undefined) ?? {})
    case "notifications:counts":
      return n.counts()
    case "notifications:get":
      return n.get(str(args[0], "id"))
    case "notifications:ingest": {
      const body = args[0] as IngestNotificationRequest
      if (!body || typeof body !== "object") throw new Error("missing ingest body")
      if (typeof body.title !== "string" || !body.title.trim()) {
        throw new Error("ingest requires title")
      }
      if (body.title.length > 240) throw new Error("ingest title is too long")
      if (body.message != null && body.message.length > 8_000) {
        throw new Error("ingest message is too long")
      }
      if (
        ![
          "turn-completed",
          "input-required",
          "permission-required",
          "failed",
          "process-exited",
          "session-started",
          "provider-notification",
          "background-output",
          "system",
        ].includes(body.type)
      ) {
        throw new Error("ingest type is invalid")
      }
      if (
        ![
          "provider-hook",
          "provider-plugin",
          "osc",
          "process",
          "system",
          "aggregated-pty",
        ].includes(body.source)
      ) {
        throw new Error("ingest source is invalid")
      }
      const request = { ...body }
      // Normalize hook event names when providerEvent is set without type refinement.
      if (request.providerEvent && request.type === "provider-notification") {
        const mapped = normalizeHookEventName(request.providerEvent)
        if (mapped) request.type = mapped
      }
      return n.ingest(request)
    }
    case "notifications:markRead":
      return n.markRead(str(args[0], "id"))
    case "notifications:markUnread":
      return n.markUnread(str(args[0], "id"))
    case "notifications:dismiss":
      return n.dismiss(str(args[0], "id"))
    case "notifications:restore":
      return n.restore(str(args[0], "id"))
    case "notifications:acknowledge":
      return n.acknowledge(str(args[0], "id"))
    case "notifications:markAllRead":
      return n.markAllRead((args[0] as MarkAllNotificationsReadRequest | undefined) ?? {})
    case "notifications:unreadBySession":
      return n.unreadBySession()
    case "notifications:markSessionUnread":
      return n.markSessionUnread(str(args[0], "sessionId"))
    case "notifications:getPreferences":
      return n.getPreferences()
    case "notifications:setPreferences":
      return n.setPreferences((args[0] as Partial<NotificationPreferences> | undefined) ?? {})
    case "notifications:bindSession": {
      const body = args[0] as BindNotificationSessionRequest
      if (!body?.sessionId) throw new Error("bindSession requires sessionId")
      n.bindSession({
        sessionId: body.sessionId,
        projectId: body.projectId ?? null,
        projectName: body.projectName ?? null,
        sessionTitle: body.sessionTitle ?? null,
        provider: body.provider ?? null,
        ptyId: body.ptyId ?? null,
      })
      return { ok: true }
    }
    case "notifications:runRetention":
      return n.runRetention()
    default:
      throw new Error(`unknown notifications channel: ${channel}`)
  }
}

export function shutdownRuntime(runtime: HostRuntime): void {
  runtime.events.emit("server:shuttingDown", [])
  runtime.workspace.stopAll()
  runtime.terminal.stopAll()
  stopAllLspSessions()
}

async function handleFs(channel: string, args: unknown[]): Promise<unknown> {
  switch (channel) {
    case "fs:readFile":
      return readFile(str(args[0], "uri"))
    case "fs:writeFile":
      await writeFile(str(args[0], "uri"), String(args[1] ?? ""))
      return null
    case "fs:writeTempDrop":
      return writeTempDrop(String(args[0] ?? "drop.bin"), str(args[1], "content"))
    case "fs:readDir":
      return readDir(str(args[0], "uri"))
    case "fs:stat":
      return stat(str(args[0], "uri"))
    default:
      throw new Error(`unknown fs channel: ${channel}`)
  }
}

async function handleGit(channel: string, args: unknown[]): Promise<unknown> {
  const rootUri = str(args[0], "rootUri")
  switch (channel) {
    case "git:isRepo":
      return gitIsRepo(rootUri)
    case "git:status":
      return gitStatus(rootUri)
    case "git:diff": {
      const opts = (args[1] as { path?: string; staged?: boolean } | undefined) ?? undefined
      return gitDiff(rootUri, opts)
    }
    case "git:show": {
      const opts = args[1] as { path?: string; ref?: "HEAD" | "INDEX" } | undefined
      const path = typeof opts?.path === "string" ? opts.path : ""
      const ref = opts?.ref === "INDEX" ? "INDEX" : "HEAD"
      return gitShow(rootUri, path, ref)
    }
    case "git:branch":
      return gitBranch(rootUri)
    case "git:summary":
      return gitSummary(rootUri)
    case "git:branches":
      return gitBranches(rootUri)
    case "git:stage":
      await gitStage(rootUri, stringArray(args[1]))
      return null
    case "git:unstage":
      await gitUnstage(rootUri, stringArray(args[1]))
      return null
    case "git:discard":
      await gitDiscard(rootUri, stringArray(args[1]))
      return null
    case "git:commit": {
      const summary = String(args[1] ?? "")
      const body = typeof args[2] === "string" ? args[2] : undefined
      await gitCommitWithBody(rootUri, summary, body)
      return null
    }
    case "git:checkout":
      await gitCheckout(rootUri, str(args[1], "branch"))
      return null
    case "git:fetch":
      await gitFetch(rootUri)
      return null
    case "git:pull":
      await gitPull(rootUri)
      return null
    case "git:push":
      await gitPush(rootUri)
      return null
    case "git:history":
      return gitHistory(rootUri, typeof args[1] === "number" ? args[1] : 50)
    default:
      throw new Error(`unknown git channel: ${channel}`)
  }
}

async function handleSearch(
  runtime: HostRuntime,
  channel: string,
  args: unknown[],
): Promise<unknown> {
  const rootUri = str(args[0], "rootUri")
  switch (channel) {
    case "search:listFiles": {
      const files = await listProjectFiles(rootUri)
      runtime.events.emit("workspace:fileIndex", [{ rootUri, files }])
      return files
    }
    case "search:project":
      return projectSearch(
        rootUri,
        String(args[1] ?? ""),
        args[2] as { caseSensitive?: boolean; regex?: boolean; fuzzy?: boolean } | undefined,
      )
    case "search:fileSearch":
      return fileSearch(
        rootUri,
        String(args[1] ?? ""),
        args[2] as { pageSize?: number; currentFile?: string } | undefined,
      )
    case "search:trackFileAccess":
      await trackFileAccess(rootUri, String(args[1] ?? ""), String(args[2] ?? ""))
      return null
    case "search:isScanReady":
      return isSearchScanReady(rootUri)
    case "search:isSupported":
      return gitIsRepo(rootUri)
    default:
      throw new Error(`unknown search channel: ${channel}`)
  }
}

function handleWorkspace(runtime: HostRuntime, channel: string, args: unknown[]): unknown {
  const rootUri = str(args[0], "rootUri")
  if (channel === "workspace:activate") return runtime.workspace.activate(runtime.events, rootUri)
  if (channel === "workspace:deactivate") return runtime.workspace.deactivate(rootUri)
  throw new Error(`unknown workspace channel: ${channel}`)
}

async function handleLsp(runtime: HostRuntime, channel: string, args: unknown[]): Promise<unknown> {
  if (channel === "lsp:start") {
    const rootUri = str(args[0], "rootUri")
    const serverId =
      typeof args[2] === "string" ? str(args[2], "serverId") : str(args[1], "serverId")
    const started = await startLspSession({
      rootUri,
      serverId,
      allowedRoots: runtime.config.allowedRoots,
    })
    if (started.error) {
      return { id: started.id, transportUrl: "", error: started.error }
    }
    return { id: started.id, transportUrl: `/ws/lsp/${started.id}` }
  }
  if (channel === "lsp:stop") {
    await stopLspSession(str(args[0], "id"))
    return null
  }
  throw new Error(`unknown lsp channel: ${channel}`)
}

function handleTerminal(
  runtime: HostRuntime,
  channel: string,
  args: unknown[],
  clientId: string,
): unknown {
  switch (channel) {
    case "terminal:create": {
      const cwdUri = str(args[0], "cwdUri")
      const launch = (args[1] as TerminalLaunch | null | undefined) ?? null
      const created = runtime.terminal.create(cwdUri, launch, clientId)
      runtime.db.recordSession(created.id, "terminal", "running", { title: created.title })
      return created
    }
    case "terminal:write":
      return runtime.terminal.write(str(args[0], "id"), String(args[1] ?? ""))
    case "terminal:writeBinary":
      return runtime.terminal.writeBinary(
        str(args[0], "id"),
        String(args[1] ?? ""),
      )
    case "terminal:resize":
      return runtime.terminal.resize(
        str(args[0], "id"),
        typeof args[1] === "number" ? args[1] : undefined,
        typeof args[2] === "number" ? args[2] : undefined,
      )
    case "terminal:attach":
      return runtime.terminal.attach(str(args[0], "id"), clientId)
    case "terminal:dispose": {
      const id = str(args[0], "id")
      runtime.terminal.dispose(id)
      runtime.db.updateSessionStatus(id, "stopped")
      return null
    }
    default:
      throw new Error(`unknown terminal channel: ${channel}`)
  }
}

function handleShell(channel: string, args: unknown[]): unknown {
  if (channel === "shell:openInApp") {
    return openInApp(str(args[0], "appId"), str(args[1], "rootUri"))
  }
  if (channel === "shell:revealInFolder") {
    return revealInFolder(str(args[0], "rootUri"))
  }
  throw new Error(`unknown shell channel: ${channel}`)
}

async function handleTasks(channel: string, args: unknown[]): Promise<unknown> {
  if (channel !== "tasks:spawn") throw new Error(`unknown tasks channel: ${channel}`)
  const req = args[0] as { command?: string; args?: string[]; cwd?: string }
  if (!req?.command || !req.cwd) throw new Error("tasks:spawn requires command and cwd")
  return spawnTask({ command: req.command, args: req.args, cwd: req.cwd })
}

function handlePerf(runtime: HostRuntime, channel: string, args: unknown[]): unknown {
  if (channel === "perf:recordStartup") {
    return runtime.perf.recordStartup((args[0] as Record<string, unknown>) ?? {})
  }
  if (channel === "perf:getStartupLogPath") return runtime.perf.getStartupLogPath()
  throw new Error(`unknown perf channel: ${channel}`)
}

function str(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`missing ${label}`)
  return value
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === "string")
}
