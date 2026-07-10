import { contextBridge, ipcRenderer } from "electron"
import { createElectronTransport, createJetApi } from "@jet/host-client"

const api = createJetApi(createElectronTransport(ipcRenderer))
contextBridge.exposeInMainWorld("jet", api)
