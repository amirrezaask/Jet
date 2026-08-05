import { Effect } from "effect"
import {
  fileSearch,
  gitIsRepo,
  isSearchScanReady,
  listProjectFiles,
  loadGlobalYaadercScanRoots,
  openInApp,
  revealInFolder,
  projectSearch,
  readDir,
  readFile,
  spawnTask,
  startLspSession,
  stat,
  stopLspSession,
  trackFileAccess,
  writeFile,
  writeTempDrop,
  assertAllowedUri,
  type TerminalLaunch,
} from "@yaade/node-host"
import {
  OperationFailedError,
  PathOutsideRootsError,
  UnknownChannelError,
  unknownChannel,
  type HostRpcError,
} from "@yaade/rpc"
import type {
  BindNotificationSessionRequest,
  IngestNotificationRequest,
  ListNotificationsRequest,
  MarkAllNotificationsReadRequest,
  NotificationPreferences,
} from "@yaade/shared"
import { fileUriToPath } from "@yaade/shared"
import { GitServiceLive, GitServiceTag } from "./effect/git.js"
import { HostRuntimeTag } from "./effect/tags.js"
import type { HostRuntime } from "./host-runtime.js"
import { normalizeHookEventName } from "./notifications/index.js"
import { installProjectHooksForProvider } from "./agents/index.js"

export type { HostRuntime } from "./host-runtime.js"
export { createRuntime, shutdownRuntime } from "./host-runtime.js"

export function mapDispatchError(channel: string, error: unknown): HostRpcError {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes("not allowed") || message.includes("PATH_OUTSIDE")) {
    return new PathOutsideRootsError({ message })
  }
  if (message.startsWith("unknown host channel:")) {
    return unknownChannel(channel)
  }
  if (message.startsWith("unknown")) {
    return new UnknownChannelError({ channel, message })
  }
  return new OperationFailedError({ message, cause: error })
}

export type DispatchEnv = HostRuntimeTag | GitServiceTag

export function dispatch(
  channel: string,
  args: unknown[],
  clientId: string,
): Effect.Effect<unknown, HostRpcError, DispatchEnv> {
  return Effect.gen(function* () {
    if (channel.startsWith("git:")) {
      return yield* handleGitEffect(channel, args)
    }
    const runtime = yield* HostRuntimeTag
    return yield* Effect.tryPromise({
      try: () => dispatchImpl(runtime, channel, args, clientId),
      catch: err => mapDispatchError(channel, err),
    })
  })
}

export function dispatchPromise(
  runtime: HostRuntime,
  channel: string,
  args: unknown[],
  clientId: string,
): Promise<unknown> {
  return Effect.runPromise(
    dispatch(channel, args, clientId).pipe(
      Effect.provideService(HostRuntimeTag, runtime),
      Effect.provide(GitServiceLive),
    ),
  )
}

async function dispatchImpl(
  runtime: HostRuntime,
  channel: string,
  args: unknown[],
  clientId: string,
): Promise<unknown> {
  if (channel === "fs:showOpenFolderDialog" || channel === "fs:showSaveFileDialog") return null
  if (channel === "yaade:getLaunchConfig") return runtime.config.launchConfig
  if (channel === "yaade:getHomeDir") return runtime.homeDir
  if (channel === "yaade:loadGlobalYaadercScanRoots") {
    return loadGlobalYaadercScanRoots(runtime.homeDir)
  }

  if (channel.startsWith("agents:")) {
    return handleAgents(runtime, channel, args)
  }
  if (channel.startsWith("notifications:")) {
    return handleNotifications(runtime, channel, args)
  }
  if (channel.startsWith("fs:")) return handleFs(channel, args)
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
      const provider = parseAgentProvider(body.provider ?? "")
      if (provider && body.ptyId) {
        runtime.agents.onProcessStarted({
          provider,
          sessionId: body.sessionId,
          processId: body.ptyId,
          projectId: body.projectId ?? undefined,
        })
      }
      return { ok: true }
    }
    case "notifications:runRetention":
      return n.runRetention()
    default:
      throw new Error(`unknown notifications channel: ${channel}`)
  }
}

async function handleAgents(
  runtime: HostRuntime,
  channel: string,
  args: unknown[],
): Promise<unknown> {
  const agents = runtime.agents
  switch (channel) {
    case "agents:getSnapshot":
      return agents.getSnapshot(str(args[0], "sessionId"))
    case "agents:listEvents": {
      const sessionId = str(args[0], "sessionId")
      const opts = (args[1] as { limit?: number; before?: string } | undefined) ?? {}
      return agents.listEvents(sessionId, opts)
    }
    case "agents:ingestNative": {
      const body = args[0] as {
        provider: string
        sessionId: string
        payload: unknown
        processId?: string
        projectId?: string
        focusedSessionId?: string | null
        appFocused?: boolean
      }
      if (!body?.sessionId || !body.provider) {
        throw new Error("agents:ingestNative requires provider + sessionId")
      }
      const provider = parseAgentProvider(body.provider)
      if (!provider) throw new Error("invalid agent provider")
      const result = agents.ingestNative(body.payload, {
        provider,
        sessionId: body.sessionId,
        processId: body.processId,
        projectId: body.projectId,
        focusedSessionId: body.focusedSessionId,
        appFocused: body.appFocused,
      })
      return {
        eventCount: result.events.length,
        snapshot: result.snapshot,
        nativeSessionId: result.snapshot?.nativeSessionId ?? null,
      }
    }
    case "agents:installProjectHooks": {
      const body = args[0] as { provider: string; projectRoot: string }
      if (!body?.projectRoot || !body.provider) {
        throw new Error("agents:installProjectHooks requires provider + projectRoot")
      }
      const provider = parseAgentProvider(body.provider)
      if (!provider) throw new Error("invalid agent provider")
      const written = installProjectHooksForProvider(
        provider,
        body.projectRoot,
        runtime.config.dataDir,
      )
      return { written }
    }
    default:
      throw new Error(`unknown agents channel: ${channel}`)
  }
}

function parseAgentProvider(
  value: string,
): "claude" | "codex" | "cursor" | "opencode" | "grok" | null {
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

function handleGitEffect(
  channel: string,
  args: unknown[],
): Effect.Effect<unknown, HostRpcError, GitServiceTag> {
  const rootUri = str(args[0], "rootUri")
  return Effect.gen(function* () {
    const git = yield* GitServiceTag
    switch (channel) {
      case "git:isRepo":
        return yield* git.isRepo(rootUri)
      case "git:status":
        return yield* git.status(rootUri)
      case "git:diff": {
        const opts = (args[1] as { path?: string; staged?: boolean } | undefined) ?? undefined
        return yield* git.diff(rootUri, opts)
      }
      case "git:show": {
        const opts = args[1] as { path?: string; ref?: "HEAD" | "INDEX" } | undefined
        const filePath = typeof opts?.path === "string" ? opts.path : ""
        const ref = opts?.ref === "INDEX" ? "INDEX" : "HEAD"
        return yield* git.show(rootUri, filePath, ref)
      }
      case "git:branch":
        return yield* git.branch(rootUri)
      case "git:summary":
        return yield* git.summary(rootUri)
      case "git:branches":
        return yield* git.branches(rootUri)
      case "git:stage":
        yield* git.stage(rootUri, stringArray(args[1]))
        return null
      case "git:unstage":
        yield* git.unstage(rootUri, stringArray(args[1]))
        return null
      case "git:discard":
        yield* git.discard(rootUri, stringArray(args[1]))
        return null
      case "git:commit": {
        const summary = String(args[1] ?? "")
        const body = typeof args[2] === "string" ? args[2] : undefined
        yield* git.commit(rootUri, summary, body)
        return null
      }
      case "git:checkout":
        yield* git.checkout(rootUri, str(args[1], "branch"))
        return null
      case "git:fetch":
        yield* git.fetch(rootUri)
        return null
      case "git:pull":
        yield* git.pull(rootUri)
        return null
      case "git:push":
        yield* git.push(rootUri)
        return null
      case "git:history":
        return yield* git.history(rootUri, typeof args[1] === "number" ? args[1] : 50)
      default:
        return yield* Effect.fail(unknownChannel(channel))
    }
  }).pipe(
    Effect.catchTag("GitCommandFailed", e =>
      Effect.fail(new OperationFailedError({ message: e.message, cause: e })),
    ),
  )
}

async function handleSearch(
  runtime: HostRuntime,
  channel: string,
  args: unknown[],
): Promise<unknown> {
  const rootUri = str(args[0], "rootUri")
  switch (channel) {
    case "search:listFiles": {
      // Return via RPC only — do not push up to 50k paths into EventHub/WS replay.
      return listProjectFiles(rootUri)
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

async function handleTerminal(
  runtime: HostRuntime,
  channel: string,
  args: unknown[],
  clientId: string,
): Promise<unknown> {
  switch (channel) {
    case "terminal:create": {
      const cwdUri = str(args[0], "cwdUri")
      await assertAllowedUri(cwdUri, runtime.config.allowedRoots, fileUriToPath)
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
    case "terminal:ack":
      return runtime.terminal.acknowledgeData(
        str(args[0], "id"),
        typeof args[1] === "number" ? args[1] : Number(args[1] ?? 0),
      )
    case "terminal:attach":
      return runtime.terminal.attach(str(args[0], "id"), clientId)
    case "terminal:getCwd":
      return runtime.terminal.getCwd(str(args[0], "id"))
    case "terminal:getForegroundProcess":
      return runtime.terminal.getForegroundProcess(str(args[0], "id"))
    case "terminal:dispose": {
      const id = str(args[0], "id")
      runtime.terminal.dispose(id)
      runtime.db.updateSessionStatus(id, "stopped")
      const binding = runtime.notifications.bindingForPty(id)
      if (binding?.sessionId) {
        runtime.agents.disposeSession(binding.sessionId)
      }
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
