const { contextBridge, ipcRenderer } = require("electron")

const windowChrome = Object.freeze({
  customTitlebar: true,
  platform: process.platform,
  titlebarHeight: 40,
  trafficLights: process.platform === "darwin",
})

contextBridge.exposeInMainWorld(
  "yaadeDesktop",
  Object.freeze({
    windowChrome,
    getServerConnection: () => ipcRenderer.invoke("yaade:server:get"),
    connectToServer: serverUrl => ipcRenderer.invoke("yaade:server:connect", serverUrl),
  }),
)
