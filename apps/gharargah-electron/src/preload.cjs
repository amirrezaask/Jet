const { contextBridge, ipcRenderer } = require("electron")

const windowChrome = Object.freeze({
  customTitlebar: true,
  platform: process.platform,
  titlebarHeight: 40,
  trafficLights: process.platform === "darwin",
})

contextBridge.exposeInMainWorld(
  "gharargahDesktop",
  Object.freeze({
    windowChrome,
    getServerConnection: () => ipcRenderer.invoke("gharargah:server:get"),
    connectToServer: serverUrl => ipcRenderer.invoke("gharargah:server:connect", serverUrl),
  }),
)
