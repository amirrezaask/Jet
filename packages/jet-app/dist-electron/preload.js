"use strict";
const electron = require("electron");
const api = {
  fs: {
    readFile: (uri) => electron.ipcRenderer.invoke("fs:readFile", uri),
    writeFile: (uri, content) => electron.ipcRenderer.invoke("fs:writeFile", uri, content),
    readDir: (uri) => electron.ipcRenderer.invoke("fs:readDir", uri),
    stat: (uri) => electron.ipcRenderer.invoke("fs:stat", uri),
    showOpenFolderDialog: () => electron.ipcRenderer.invoke("fs:showOpenFolderDialog")
  },
  git: {
    isRepo: (rootUri) => electron.ipcRenderer.invoke("git:isRepo", rootUri),
    status: (rootUri) => electron.ipcRenderer.invoke("git:status", rootUri),
    diff: (rootUri, opts) => electron.ipcRenderer.invoke("git:diff", rootUri, opts)
  },
  lsp: {
    start: (rootUri, languageId) => electron.ipcRenderer.invoke("lsp:start", rootUri, languageId),
    stop: (id) => electron.ipcRenderer.invoke("lsp:stop", id),
    onCrashed: () => () => {
    }
  }
};
electron.contextBridge.exposeInMainWorld("jet", api);
