import type { GharargahHostAPI } from "@gharargah/workspace"
import type { GharargahHostTransport } from "./transport.js"

// The Rust host owns the authoritative replay. This buffer only bridges the
// attach handshake, so keeping a second multi-megabyte copy is wasteful.
const MAX_BUFFERED_TERMINAL_CHARS = 64 * 1024

export function createGharargahApi(transport: GharargahHostTransport): GharargahHostAPI {
  const terminalDataListeners = new Map<string, Set<(data: string) => void>>()
  type BufferedTerminalData = { data: string; sequence: number }
  const terminalDataBuffers = new Map<string, BufferedTerminalData[]>()
  const terminalDataBufferSizes = new Map<string, number>()
  const terminalReplayFloors = new Map<string, number>()

  transport.on("agents:threadUpdated", (...args: unknown[]) => {
    const thread = args[0] as import("@gharargah/agents").AgentThread
    for (const cb of agentThreadUpdatedListeners) cb(thread)
  })
  transport.on("agents:threadDelta", (...args: unknown[]) => {
    const delta = args[0] as import("@gharargah/agents").AgentThreadDelta
    for (const cb of agentThreadDeltaListeners) cb(delta)
  })
  transport.on("agents:permissionRequest", (...args: unknown[]) => {
    const request = args[0] as {
      workspaceRootUri?: string
      workspaceRootPath?: string
      threadId: string
      request: import("@gharargah/agents").AgentPermissionRequest
    }
    for (const cb of agentPermissionListeners) {
      cb({
        workspaceRootUri: request.workspaceRootUri ?? "",
        threadId: request.threadId,
        permission: request.request,
      })
    }
  })
  transport.on("agents:structuredDelta", (...args: unknown[]) => {
    const delta = args[0] as import("@gharargah/agents").AgentStructuredDelta
    for (const cb of agentStructuredDeltaListeners) cb(delta)
  })
  transport.on("lsp:crashed", (...args: unknown[]) => {
    const id = args[0] as string
    for (const cb of lspCrashListeners) cb(id)
  })
  transport.on("fs:changed", (...args: unknown[]) => {
    const uri = args[0] as string
    for (const cb of fileChangeListeners) cb(uri)
  })
  transport.on("gharargah:close-tab", () => {
    window.dispatchEvent(new CustomEvent("jet-close-tab"))
  })
  transport.on("workspace:fileIndex", (...args: unknown[]) => {
    const payload = args[0] as { rootUri: string; files: string[] }
    for (const cb of fileIndexListeners) cb(payload.rootUri, payload.files)
  })
  transport.on("workspace:searchReady", (...args: unknown[]) => {
    const payload = args[0] as { rootUri: string }
    for (const cb of searchReadyListeners) cb(payload.rootUri)
  })
  transport.on("terminal:data", (...args: unknown[]) => {
    const id = args[0] as string
    const data = args[1] as string
    const sequence = (args[2] as number | undefined) ?? 0
    const floor = terminalReplayFloors.get(id) ?? 0
    if (sequence > 0 && sequence <= floor) return
    const listeners = terminalDataListeners.get(id)
    if (listeners && listeners.size > 0) {
      listeners.forEach(cb => cb(data))
      return
    }
    const pending = terminalDataBuffers.get(id) ?? []
    pending.push({ data, sequence })
    let size = (terminalDataBufferSizes.get(id) ?? 0) + data.length
    while (size > MAX_BUFFERED_TERMINAL_CHARS && pending.length > 1) {
      size -= pending.shift()!.data.length
    }
    terminalDataBuffers.set(id, pending)
    terminalDataBufferSizes.set(id, size)
  })
  transport.on("terminal:exit", (...args: unknown[]) => {
    const id = args[0] as string
    const exitCode = args[1] as number
    const signal = args[2] as number | undefined
    for (const cb of terminalExitListeners) cb(id, exitCode, signal)
  })

  const lspCrashListeners = new Set<(id: string) => void>()
  const agentThreadUpdatedListeners = new Set<(thread: import("@gharargah/agents").AgentThread) => void>()
  const agentThreadDeltaListeners = new Set<(delta: import("@gharargah/agents").AgentThreadDelta) => void>()
  const agentPermissionListeners = new Set<(input: {
    workspaceRootUri: string
    threadId: string
    permission: import("@gharargah/agents").AgentPermissionRequest
  }) => void>()
  const agentStructuredDeltaListeners = new Set<
    (delta: import("@gharargah/agents").AgentStructuredDelta) => void
  >()
  const fileChangeListeners = new Set<(uri: string) => void>()
  const fileIndexListeners = new Set<(rootUri: string, files: string[]) => void>()
  const searchReadyListeners = new Set<(rootUri: string) => void>()
  const terminalExitListeners = new Set<(id: string, exitCode: number, signal?: number) => void>()

  return {
    fs: {
      readFile: uri => transport.invoke("fs:readFile", uri),
      writeFile: (uri, content) => transport.invoke("fs:writeFile", uri, content),
      readDir: uri => transport.invoke("fs:readDir", uri),
      stat: uri => transport.invoke("fs:stat", uri),
      showOpenFolderDialog: () => transport.invoke("fs:showOpenFolderDialog"),
      showSaveFileDialog: (defaultPath?: string) =>
        transport.invoke("fs:showSaveFileDialog", defaultPath),
      onFileChanged: callback => {
        fileChangeListeners.add(callback)
        return () => fileChangeListeners.delete(callback)
      },
    },
    workspace: {
      activate: rootUri => transport.invoke("workspace:activate", rootUri),
      deactivate: rootUri => transport.invoke("workspace:deactivate", rootUri),
      onFileIndex: callback => {
        fileIndexListeners.add(callback)
        return () => fileIndexListeners.delete(callback)
      },
      onSearchReady: callback => {
        searchReadyListeners.add(callback)
        return () => searchReadyListeners.delete(callback)
      },
    },
    agents: {
      listThreads: (workspaceRootUri, workspaceRootPath) =>
        transport.invoke("agents:listThreads", workspaceRootUri, workspaceRootPath),
      readThread: (workspaceRootUri, workspaceRootPath, threadId) =>
        transport.invoke("agents:readThread", workspaceRootUri, workspaceRootPath, threadId),
      createThread: input => transport.invoke("agents:createThread", input),
      sendMessage: input => transport.invoke("agents:sendMessage", input),
      interruptTurn: input => transport.invoke("agents:interruptTurn", input),
      resolvePermission: input => transport.invoke("agents:resolvePermission", input),
      setArchived: input => transport.invoke("agents:setArchived", input),
      updateThreadSettings: input => transport.invoke("agents:updateThreadSettings", input),
      listAgents: () => transport.invoke("agents:listAgents"),
      refreshAgents: () => transport.invoke("agents:refreshAgents"),
      listProviders: () => transport.invoke("agents:listProviders"),
      refreshProviders: () => transport.invoke("agents:refreshProviders"),
      onThreadUpdated: callback => {
        agentThreadUpdatedListeners.add(callback)
        return () => agentThreadUpdatedListeners.delete(callback)
      },
      onThreadDelta: callback => {
        agentThreadDeltaListeners.add(callback)
        return () => agentThreadDeltaListeners.delete(callback)
      },
      onPermissionRequest: callback => {
        agentPermissionListeners.add(callback)
        return () => agentPermissionListeners.delete(callback)
      },
      getAcpTrace: (providerId?: string) =>
        transport.invoke("agents:getAcpTrace", providerId ?? "cursor-acp"),
      getConnectionState: (providerId?: string) =>
        transport.invoke("agents:getConnectionState", providerId ?? "cursor-acp"),
      forceStopProvider: input => transport.invoke("agents:forceStopProvider", input),
      listAcpSessions: input => transport.invoke("agents:listAcpSessions", input),
      authenticate: input => transport.invoke("agents:authenticate", input),
      onStructuredDelta: callback => {
        agentStructuredDeltaListeners.add(callback)
        return () => agentStructuredDeltaListeners.delete(callback)
      },
    },
    search: {
      project: (rootUri, query, opts) => transport.invoke("search:project", rootUri, query, opts),
      listFiles: rootUri => transport.invoke("search:listFiles", rootUri),
      fileSearch: (rootUri, query, opts) =>
        transport.invoke("search:fileSearch", rootUri, query, opts),
      trackFileAccess: (rootUri, query, path) =>
        transport.invoke("search:trackFileAccess", rootUri, query, path),
      isScanReady: rootUri => transport.invoke("search:isScanReady", rootUri),
      isSupported: rootUri => transport.invoke("search:isSupported", rootUri),
    },
    lsp: {
      start: (rootUri, languageId, command, args) =>
        transport.invoke("lsp:start", rootUri, languageId, command, args),
      stop: id => transport.invoke("lsp:stop", id),
      onCrashed: cb => {
        lspCrashListeners.add(cb)
        return () => lspCrashListeners.delete(cb)
      },
    },
    tasks: {
      spawn: req => transport.invoke("tasks:spawn", req),
    },
    git: {
      isRepo: rootUri => transport.invoke("git:isRepo", rootUri),
      status: rootUri => transport.invoke("git:status", rootUri),
      diff: (rootUri, opts) => transport.invoke("git:diff", rootUri, opts),
      branch: rootUri => transport.invoke("git:branch", rootUri),
      summary: rootUri => transport.invoke("git:summary", rootUri),
      branches: rootUri => transport.invoke("git:branches", rootUri),
      stage: (rootUri, paths) => transport.invoke("git:stage", rootUri, paths),
      unstage: (rootUri, paths) => transport.invoke("git:unstage", rootUri, paths),
      discard: (rootUri, paths) => transport.invoke("git:discard", rootUri, paths),
      commit: (rootUri, summary, body) => transport.invoke("git:commit", rootUri, summary, body),
      checkout: (rootUri, branch) => transport.invoke("git:checkout", rootUri, branch),
      fetch: rootUri => transport.invoke("git:fetch", rootUri),
      pull: rootUri => transport.invoke("git:pull", rootUri),
      push: rootUri => transport.invoke("git:push", rootUri),
      history: (rootUri, limit) => transport.invoke("git:history", rootUri, limit),
    },
    shell: {
      openInApp: (appId, rootUri) => transport.invoke("shell:openInApp", appId, rootUri),
    },
    terminal: {
      create: (cwdUri, launch) => transport.invoke("terminal:create", cwdUri, launch),
      attach: async id => {
        const result = await transport.invoke<{
          id: string
          title?: string
          output: string
          lastSequence: number
          status: "running" | "exited"
          exitCode?: number
          signal?: number
        } | null>("terminal:attach", id)
        if (result) {
          terminalReplayFloors.set(id, result.lastSequence)
          const pending = terminalDataBuffers.get(id)
          if (pending) {
            const kept = pending.filter(
              chunk => chunk.sequence === 0 || chunk.sequence > result.lastSequence,
            )
            let size = 0
            for (const chunk of kept) size += chunk.data.length
            terminalDataBuffers.set(id, kept)
            terminalDataBufferSizes.set(id, size)
          }
        }
        return result
      },
      write: (id, data) => transport.invoke("terminal:write", id, data),
      resize: (id, cols, rows) => transport.invoke("terminal:resize", id, cols, rows),
      onData: (id, callback) => {
        let set = terminalDataListeners.get(id)
        if (!set) {
          set = new Set()
          terminalDataListeners.set(id, set)
        }
        set.add(callback)
        const pending = terminalDataBuffers.get(id)
        if (pending) {
          for (const chunk of pending) callback(chunk.data)
          terminalDataBuffers.delete(id)
          terminalDataBufferSizes.delete(id)
        }
        return () => {
          set!.delete(callback)
          if (set!.size === 0) terminalDataListeners.delete(id)
        }
      },
      onExit: cb => {
        terminalExitListeners.add(cb)
        return () => terminalExitListeners.delete(cb)
      },
      dispose: id => {
        terminalDataBuffers.delete(id)
        terminalDataBufferSizes.delete(id)
        terminalDataListeners.delete(id)
        terminalReplayFloors.delete(id)
        return transport.invoke("terminal:dispose", id)
      },
    },
    getLaunchConfig: () => transport.invoke("gharargah:getLaunchConfig"),
    getHomeDir: () => transport.invoke("gharargah:getHomeDir"),
    loadGlobalGharargahrcScanRoots: () => transport.invoke("gharargah:loadGlobalGharargahrcScanRoots"),
    onLaunch: cb => {
      return transport.on("gharargah:launch", (...args: unknown[]) => {
        cb(args[0] as import("@gharargah/workspace").LaunchConfig)
      })
    },
    syncNativeChrome: colors => transport.invoke("ui:syncNativeChrome", colors),
    recordStartup: record => transport.invoke("perf:recordStartup", record),
    getStartupLogPath: () => transport.invoke("perf:getStartupLogPath"),
  }
}
