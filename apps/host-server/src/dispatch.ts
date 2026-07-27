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
  isSearchScanReady,
  listProjectFiles,
  loadGlobalGharargahrcScanRoots,
  openInApp,
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
import type { EventHub } from "./events.js"
import type { ProjectDatabase } from "./persistence.js"
import type { HostConfig } from "./config.js"
import { WorkspaceHost } from "./workspace.js"

export type HostRuntime = {
  config: HostConfig
  events: EventHub
  db: ProjectDatabase
  terminal: TerminalHost
  workspace: WorkspaceHost
  perf: PerfHost
  homeDir: string
}

export function createRuntime(config: HostConfig, events: EventHub, db: ProjectDatabase): HostRuntime {
  const terminal = new TerminalHost()
  terminal.setEmit((channel, args) => events.emit(channel, args))
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
  }
  setLspCrashHandler(id => events.emit("lsp:crashed", [id]))
  return runtime
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
    const command = typeof args[2] === "string" ? args[2] : undefined
    const cmdArgs = Array.isArray(args[3]) ? (args[3] as string[]) : undefined
    const started = await startLspSession({
      rootUri,
      command,
      args: cmdArgs,
      onSpawnError: id => runtime.events.emit("lsp:crashed", [id]),
    })
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
