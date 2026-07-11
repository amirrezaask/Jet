import type { JetElectronAPI } from "@jet/workspace"
import type { JetHostTransport } from "./transport.js"

const MAX_BUFFERED_TERMINAL_CHARS = 4 * 1024 * 1024

export function createJetApi(transport: JetHostTransport): JetElectronAPI {
  const terminalDataListeners = new Map<string, Set<(data: string) => void>>()
  type BufferedTerminalData = { data: string; sequence: number }
  const terminalDataBuffers = new Map<string, BufferedTerminalData[]>()
  const terminalDataBufferSizes = new Map<string, number>()
  const terminalReplayFloors = new Map<string, number>()

  transport.on("agents:threadUpdated", (...args: unknown[]) => {
    const thread = args[0] as import("@jet/agents").AgentThread
    for (const cb of agentThreadUpdatedListeners) cb(thread)
  })
  transport.on("lsp:crashed", (...args: unknown[]) => {
    const id = args[0] as string
    for (const cb of lspCrashListeners) cb(id)
  })
  transport.on("fs:changed", (...args: unknown[]) => {
    const uri = args[0] as string
    for (const cb of fileChangeListeners) cb(uri)
  })
  transport.on("jet:close-tab", () => {
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
  const agentThreadUpdatedListeners = new Set<(thread: import("@jet/agents").AgentThread) => void>()
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
      setArchived: input => transport.invoke("agents:setArchived", input),
      updateThreadSettings: input => transport.invoke("agents:updateThreadSettings", input),
      listProviders: () => transport.invoke("agents:listProviders"),
      refreshProviders: () => transport.invoke("agents:refreshProviders"),
      onThreadUpdated: callback => {
        agentThreadUpdatedListeners.add(callback)
        return () => agentThreadUpdatedListeners.delete(callback)
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
            terminalDataBuffers.set(
              id,
              pending.filter(chunk => chunk.sequence === 0 || chunk.sequence > result.lastSequence),
            )
            terminalDataBufferSizes.set(
              id,
              pending.reduce((total, chunk) =>
                total + (chunk.sequence === 0 || chunk.sequence > result.lastSequence ? chunk.data.length : 0), 0),
            )
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
    getLaunchConfig: () => transport.invoke("jet:getLaunchConfig"),
    getHomeDir: () => transport.invoke("jet:getHomeDir"),
    loadGlobalJetrcScanRoots: () => transport.invoke("jet:loadGlobalJetrcScanRoots"),
    onLaunch: cb => {
      return transport.on("jet:launch", (...args: unknown[]) => {
        cb(args[0] as import("@jet/workspace").LaunchConfig)
      })
    },
    syncNativeChrome: colors => transport.invoke("ui:syncNativeChrome", colors),
    recordStartup: record => transport.invoke("perf:recordStartup", record),
    getStartupLogPath: () => transport.invoke("perf:getStartupLogPath"),
  }
}
