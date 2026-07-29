const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld(
  "gharargahDesktop",
  Object.freeze({
    getServerConnection: () => ipcRenderer.invoke("gharargah:server:get"),
    connectToServer: serverUrl => ipcRenderer.invoke("gharargah:server:connect", serverUrl),
  }),
)
