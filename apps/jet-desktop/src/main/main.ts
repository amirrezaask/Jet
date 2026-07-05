import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { resolveLaunchTarget, loadGlobalJetrcScanRoots, type LaunchConfig } from "@jet/node-host"
import { registerFsHandlers } from "./fs.js"
import { registerSearchHandlers } from "./search.js"
import { registerLspHandlers, stopAllLsp, setLspCrashHandler } from "./lsp-bridge.js"
import { registerTaskHandlers } from "./tasks.js"
import { registerWorkspaceHost, stopWorkspaceHost } from "./workspace-host.js"
import { stopAllBackgroundWorkers, prewarmBackgroundWorkers } from "./background-pool.js"

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null
let launchConfig: LaunchConfig | null = null
const pendingLaunchPaths: string[] = []

function getWindow() {
  return mainWindow
}

function parseUserArgs(argv: string[]): string[] {
  const dash = argv.indexOf("--")
  const raw = dash >= 0 ? argv.slice(dash + 1) : app.isPackaged ? argv.slice(1) : []
  return raw.filter(a => !a.startsWith("-"))
}

async function resolveLaunchPath(absPath: string): Promise<LaunchConfig> {
  return resolveLaunchTarget([absPath], path.dirname(absPath))
}

function resolveLaunchConfigFast(userArgs: string[]): LaunchConfig | null | undefined {
  if (!app.isPackaged && userArgs.length === 0) return null
  if (userArgs.length === 0) return { workspacePath: path.resolve(process.cwd()) }
  if (userArgs.length === 1) {
    const raw = userArgs[0]!
    const target = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw)
    try {
      const info = fs.statSync(target)
      if (info.isDirectory()) return { workspacePath: target }
    } catch {
      return null
    }
  }
  return undefined
}

function deliverLaunchConfig(config: LaunchConfig | null, notifyRenderer: boolean): void {
  launchConfig = config
  if (!notifyRenderer || !config) return
  const wc = getWindow()?.webContents
  if (!wc || wc.isDestroyed()) return
  const send = () => {
    if (!wc.isDestroyed()) wc.send("jet:launch", config)
  }
  if (wc.isLoading()) wc.once("did-finish-load", send)
  else send()
}

function queueLaunchPath(absPath: string): void {
  pendingLaunchPaths.push(absPath)
}

async function flushPendingLaunchPaths(): Promise<void> {
  if (pendingLaunchPaths.length === 0) return
  const last = pendingLaunchPaths[pendingLaunchPaths.length - 1]!
  pendingLaunchPaths.length = 0
  const config = await resolveLaunchPath(last)
  if (mainWindow?.webContents.isLoading()) {
    launchConfig = config
  } else {
    mainWindow?.webContents.send("jet:launch", config)
  }
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
  const isMac = process.platform === "darwin"
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#0a0a0c",
    titleBarStyle: isMac ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const e2e = process.env.JET_E2E === "1"

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    if (!e2e) mainWindow.webContents.openDevTools({ mode: "detach" })
  } else if (isDev && !e2e) {
    mainWindow.loadURL("http://localhost:5173")
    mainWindow.webContents.openDevTools({ mode: "detach" })
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"))
  }

  mainWindow.on("closed", () => {
    mainWindow = null
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on("second-instance", (_e, argv) => {
    const args = parseUserArgs(argv)
    if (args.length > 0) {
      void resolveLaunchTarget(args, process.cwd()).then(config => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.focus()
          mainWindow.webContents.send("jet:launch", config)
        } else {
          launchConfig = config
        }
      })
    } else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

app.on("open-file", (e, filePath) => {
  e.preventDefault()
  queueLaunchPath(filePath)
  void flushPendingLaunchPaths()
})

app.whenReady().then(() => {
  installAppMenu()
  registerFsHandlers(ipcMain, dialog)
  registerWorkspaceHost(ipcMain, getWindow)
  registerSearchHandlers(ipcMain)
  registerLspHandlers(ipcMain, getWindow)
  registerTaskHandlers(ipcMain)
  setLspCrashHandler(id => {
    getWindow()?.webContents.send("lsp:crashed", id)
  })

  ipcMain.handle("jet:getLaunchConfig", () => {
    const config = launchConfig
    launchConfig = null
    return config
  })
  ipcMain.handle("jet:getHomeDir", () => os.homedir())
  ipcMain.handle("jet:loadGlobalJetrcScanRoots", () => loadGlobalJetrcScanRoots(os.homedir()))

  const userArgs = parseUserArgs(process.argv)

  createWindow()
  prewarmBackgroundWorkers()

  if (pendingLaunchPaths.length > 0) {
    const last = pendingLaunchPaths[pendingLaunchPaths.length - 1]!
    pendingLaunchPaths.length = 0
    void resolveLaunchPath(last).then(c => deliverLaunchConfig(c, true))
  } else {
    const fast = resolveLaunchConfigFast(userArgs)
    if (fast !== undefined) {
      deliverLaunchConfig(fast, false)
    } else {
      void resolveLaunchTarget(userArgs, process.cwd()).then(c => deliverLaunchConfig(c, true))
    }
  }
})

app.on("window-all-closed", () => {
  stopAllLsp()
  stopWorkspaceHost()
  stopAllBackgroundWorkers()
  if (process.platform !== "darwin") app.quit()
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
