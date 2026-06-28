import { contextBridge, ipcRenderer } from "electron"
import type { JetElectronAPI } from "@jet/workspace"

const api: JetElectronAPI = {
  fs: {
    readFile: uri => ipcRenderer.invoke("fs:readFile", uri),
    writeFile: (uri, content) => ipcRenderer.invoke("fs:writeFile", uri, content),
    readDir: uri => ipcRenderer.invoke("fs:readDir", uri),
    stat: uri => ipcRenderer.invoke("fs:stat", uri),
    showOpenFolderDialog: () => ipcRenderer.invoke("fs:showOpenFolderDialog"),
    showSaveFileDialog: (defaultPath?: string) =>
      ipcRenderer.invoke("fs:showSaveFileDialog", defaultPath),
  },
  git: {
    isRepo: rootUri => ipcRenderer.invoke("git:isRepo", rootUri),
    status: rootUri => ipcRenderer.invoke("git:status", rootUri),
    diff: (rootUri, opts) => ipcRenderer.invoke("git:diff", rootUri, opts),
  },
  lsp: {
    start: (rootUri, languageId) => ipcRenderer.invoke("lsp:start", rootUri, languageId),
    stop: id => ipcRenderer.invoke("lsp:stop", id),
    onCrashed: () => () => {},
  },
}

contextBridge.exposeInMainWorld("jet", api)
