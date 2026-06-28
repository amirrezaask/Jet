import { contextBridge, ipcRenderer } from "electron"
import type { JetElectronAPI } from "@jet/workspace"

const lspCrashListeners = new Set<(id: string) => void>()
ipcRenderer.on("lsp:crashed", (_e, id: string) => {
  for (const cb of lspCrashListeners) cb(id)
})

const fileChangeListeners = new Set<(uri: string) => void>()
ipcRenderer.on("fs:changed", (_e, uri: string) => {
  for (const cb of fileChangeListeners) cb(uri)
})

const terminalDataListeners = new Map<string, Set<(data: string) => void>>()
ipcRenderer.on("terminal:data", (_e, id: string, data: string) => {
  terminalDataListeners.get(id)?.forEach(cb => cb(data))
})

ipcRenderer.on("jet:close-tab", () => {
  window.dispatchEvent(new CustomEvent("jet-close-tab"))
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
    watchWorkspace: rootUri => ipcRenderer.invoke("fs:watchWorkspace", rootUri),
    onFileChanged: callback => {
      fileChangeListeners.add(callback)
      return () => fileChangeListeners.delete(callback)
    },
  },
  git: {
    isRepo: rootUri => ipcRenderer.invoke("git:isRepo", rootUri),
    status: rootUri => ipcRenderer.invoke("git:status", rootUri),
    diff: (rootUri, opts) => ipcRenderer.invoke("git:diff", rootUri, opts),
    branch: rootUri => ipcRenderer.invoke("git:branch", rootUri),
    stage: (rootUri, paths) => ipcRenderer.invoke("git:stage", rootUri, paths),
    unstage: (rootUri, paths) => ipcRenderer.invoke("git:unstage", rootUri, paths),
    commit: (rootUri, message) => ipcRenderer.invoke("git:commit", rootUri, message),
    branches: rootUri => ipcRenderer.invoke("git:branches", rootUri),
    checkout: (rootUri, branch) => ipcRenderer.invoke("git:checkout", rootUri, branch),
  },
  search: {
    project: (rootUri, query, opts) =>
      ipcRenderer.invoke("search:project", rootUri, query, opts),
    listFiles: rootUri => ipcRenderer.invoke("search:listFiles", rootUri),
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
  terminal: {
    create: cwdUri => ipcRenderer.invoke("terminal:create", cwdUri),
    write: (id, data) => ipcRenderer.invoke("terminal:write", id, data),
    resize: (id, cols, rows) => ipcRenderer.invoke("terminal:resize", id, cols, rows),
    onData: (id, callback) => {
      let set = terminalDataListeners.get(id)
      if (!set) {
        set = new Set()
        terminalDataListeners.set(id, set)
      }
      set.add(callback)
      return () => {
        set!.delete(callback)
        if (set!.size === 0) terminalDataListeners.delete(id)
      }
    },
    dispose: id => ipcRenderer.invoke("terminal:dispose", id),
  },
}

contextBridge.exposeInMainWorld("jet", api)
