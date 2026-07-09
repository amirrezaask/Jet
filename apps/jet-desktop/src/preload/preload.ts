import { contextBridge, ipcRenderer } from "electron"
import type { JetElectronAPI } from "@jet/workspace"

const lspCrashListeners = new Set<(id: string) => void>()
const agentThreadUpdatedListeners = new Set<(thread: import("@jet/agents").AgentThread) => void>()
ipcRenderer.on("agents:threadUpdated", (_e, thread: import("@jet/agents").AgentThread) => {
  for (const cb of agentThreadUpdatedListeners) cb(thread)
})
ipcRenderer.on("lsp:crashed", (_e, id: string) => {
  for (const cb of lspCrashListeners) cb(id)
})

const fileChangeListeners = new Set<(uri: string) => void>()
ipcRenderer.on("fs:changed", (_e, uri: string) => {
  for (const cb of fileChangeListeners) cb(uri)
})

ipcRenderer.on("jet:close-tab", () => {
  window.dispatchEvent(new CustomEvent("jet-close-tab"))
})

const fileIndexListeners = new Set<(rootUri: string, files: string[]) => void>()
ipcRenderer.on("workspace:fileIndex", (_e, payload: { rootUri: string; files: string[] }) => {
  for (const cb of fileIndexListeners) cb(payload.rootUri, payload.files)
})

const searchReadyListeners = new Set<(rootUri: string) => void>()
ipcRenderer.on("workspace:searchReady", (_e, payload: { rootUri: string }) => {
  for (const cb of searchReadyListeners) cb(payload.rootUri)
})

const terminalDataListeners = new Map<string, Set<(data: string) => void>>()
const terminalDataBuffers = new Map<string, string[]>()

ipcRenderer.on("terminal:data", (_e, id: string, data: string) => {
  const listeners = terminalDataListeners.get(id)
  if (listeners && listeners.size > 0) {
    listeners.forEach(cb => cb(data))
    return
  }
  const pending = terminalDataBuffers.get(id) ?? []
  pending.push(data)
  terminalDataBuffers.set(id, pending)
})

const api: JetElectronAPI = {
  fs: {
    readFile: uri => ipcRenderer.invoke("fs:readFile", uri),
    writeFile: (uri, content) => ipcRenderer.invoke("fs:writeFile", uri, content),
    readDir: uri => ipcRenderer.invoke("fs:readDir", uri),
    stat: uri => ipcRenderer.invoke("fs:stat", uri),
    showOpenFolderDialog: () => ipcRenderer.invoke("fs:showOpenFolderDialog"),
    showSaveFileDialog: (defaultPath?: string) =>
      ipcRenderer.invoke("fs:showSaveFileDialog", defaultPath),
    onFileChanged: callback => {
      fileChangeListeners.add(callback)
      return () => fileChangeListeners.delete(callback)
    },
  },
  workspace: {
    activate: rootUri => ipcRenderer.invoke("workspace:activate", rootUri),
    deactivate: rootUri => ipcRenderer.invoke("workspace:deactivate", rootUri),
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
      ipcRenderer.invoke("agents:listThreads", workspaceRootUri, workspaceRootPath),
    readThread: (workspaceRootUri, workspaceRootPath, threadId) =>
      ipcRenderer.invoke("agents:readThread", workspaceRootUri, workspaceRootPath, threadId),
    createThread: input => ipcRenderer.invoke("agents:createThread", input),
    sendMessage: input => ipcRenderer.invoke("agents:sendMessage", input),
    interruptTurn: input => ipcRenderer.invoke("agents:interruptTurn", input),
    setArchived: input => ipcRenderer.invoke("agents:setArchived", input),
    updateThreadSettings: input => ipcRenderer.invoke("agents:updateThreadSettings", input),
    listProviders: () => ipcRenderer.invoke("agents:listProviders"),
    refreshProviders: () => ipcRenderer.invoke("agents:refreshProviders"),
    onThreadUpdated: callback => {
      agentThreadUpdatedListeners.add(callback)
      return () => agentThreadUpdatedListeners.delete(callback)
    },
  },
  search: {
    project: (rootUri, query, opts) =>
      ipcRenderer.invoke("search:project", rootUri, query, opts),
    listFiles: rootUri => ipcRenderer.invoke("search:listFiles", rootUri),
    fileSearch: (rootUri, query, opts) =>
      ipcRenderer.invoke("search:fileSearch", rootUri, query, opts),
    trackFileAccess: (rootUri, query, path) =>
      ipcRenderer.invoke("search:trackFileAccess", rootUri, query, path),
    isScanReady: rootUri => ipcRenderer.invoke("search:isScanReady", rootUri),
    isSupported: rootUri => ipcRenderer.invoke("search:isSupported", rootUri),
  },
  lsp: {
    start: (rootUri, languageId, command, args) =>
      ipcRenderer.invoke("lsp:start", rootUri, languageId, command, args),
    stop: id => ipcRenderer.invoke("lsp:stop", id),
    onCrashed: cb => {
      lspCrashListeners.add(cb)
      return () => lspCrashListeners.delete(cb)
    },
  },
  tasks: {
    spawn: req => ipcRenderer.invoke("tasks:spawn", req),
  },
  terminal: {
    create: (cwdUri, launch) => ipcRenderer.invoke("terminal:create", cwdUri, launch),
    write: (id, data) => ipcRenderer.invoke("terminal:write", id, data),
    resize: (id, cols, rows) => ipcRenderer.invoke("terminal:resize", id, cols, rows),
    onData: (id, callback) => {
      let set = terminalDataListeners.get(id)
      if (!set) {
        set = new Set()
        terminalDataListeners.set(id, set)
      }
      set.add(callback)
      const pending = terminalDataBuffers.get(id)
      if (pending) {
        for (const chunk of pending) callback(chunk)
        terminalDataBuffers.delete(id)
      }
      return () => {
        set!.delete(callback)
        if (set!.size === 0) terminalDataListeners.delete(id)
      }
    },
    dispose: id => {
      terminalDataBuffers.delete(id)
      terminalDataListeners.delete(id)
      return ipcRenderer.invoke("terminal:dispose", id)
    },
  },
  getLaunchConfig: () => ipcRenderer.invoke("jet:getLaunchConfig"),
  getHomeDir: () => ipcRenderer.invoke("jet:getHomeDir"),
  loadGlobalJetrcScanRoots: () => ipcRenderer.invoke("jet:loadGlobalJetrcScanRoots"),
  onLaunch: cb => {
    const handler = (_e: Electron.IpcRendererEvent, config: import("@jet/workspace").LaunchConfig) =>
      cb(config)
    ipcRenderer.on("jet:launch", handler)
    return () => ipcRenderer.removeListener("jet:launch", handler)
  },
  syncNativeChrome: colors => ipcRenderer.invoke("ui:syncNativeChrome", colors),
}

contextBridge.exposeInMainWorld("jet", api)
