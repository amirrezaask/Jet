import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron"
import path from "node:path"
import { registerFsHandlers } from "./fs.js"
import { registerFsWatchHandlers, stopAllWatchers } from "./fs-watch.js"
import { registerGitHandlers } from "./git.js"
import { registerSearchHandlers } from "./search.js"
import { registerLspHandlers, stopAllLsp, setLspCrashHandler } from "./lsp-bridge.js"
import { registerTerminalHandlers, stopAllTerminals } from "./terminal.js"

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null

function getWindow() {
  return mainWindow
}

function installAppMenu() {
  const closeTab = (): void => {
    getWindow()?.webContents.send("jet:close-tab")
  }

  const fileSubmenu: Electron.MenuItemConstructorOptions[] = [
    { label: "Close Tab", accelerator: "CmdOrCtrl+W", click: closeTab },
    { type: "separator" },
    process.platform === "darwin"
      ? { label: "Close Window", accelerator: "CmdOrCtrl+Shift+W", role: "close" as const }
      : { role: "close" as const },
  ]

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    { label: "File", submenu: fileSubmenu },
    { role: "editMenu" as const },
    { role: "viewMenu" as const },
    ...(process.platform === "darwin" ? [{ role: "windowMenu" as const }] : []),
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow() {
  mainWindow = new BrowserWindow({
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
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools({ mode: "detach" })
  } else if (isDev) {
    mainWindow.loadURL("http://localhost:5173")
    mainWindow.webContents.openDevTools({ mode: "detach" })
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"))
  }

  mainWindow.on("closed", () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  installAppMenu()
  registerFsHandlers(ipcMain, dialog)
  registerFsWatchHandlers(ipcMain, getWindow)
  registerGitHandlers(ipcMain)
  registerSearchHandlers(ipcMain)
  registerLspHandlers(ipcMain, getWindow)
  registerTerminalHandlers(ipcMain, getWindow)
  setLspCrashHandler(id => {
    getWindow()?.webContents.send("lsp:crashed", id)
  })
  createWindow()
})

app.on("window-all-closed", () => {
  stopAllLsp()
  stopAllWatchers()
  stopAllTerminals()
  if (process.platform !== "darwin") app.quit()
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
