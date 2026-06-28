import { app, BrowserWindow, dialog, ipcMain } from "electron"
import path from "node:path"
import { registerFsHandlers } from "./fs.js"
import { registerGitHandlers } from "./git.js"
import { registerLspHandlers, stopAllLsp } from "./lsp-bridge.js"

const isDev = !app.isPackaged

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#0a0a0c",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: "detach" })
  } else if (isDev) {
    win.loadURL("http://localhost:5173")
    win.webContents.openDevTools({ mode: "detach" })
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"))
  }
}

app.whenReady().then(() => {
  registerFsHandlers(ipcMain, dialog)
  registerGitHandlers(ipcMain)
  registerLspHandlers(ipcMain)
  createWindow()
})

app.on("window-all-closed", () => {
  stopAllLsp()
  if (process.platform !== "darwin") app.quit()
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
