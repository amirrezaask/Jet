import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  applyLoginShellEnv,
  loadGlobalJetrcScanRoots,
  resolveLaunchTarget,
  type LaunchConfig,
} from "@jet/node-host"
import {
  bindElectronRenderer,
  createHostRegistry,
  disposeTerminalsForClient,
  sendToRenderer,
  stopAllBackgroundWorkers,
  stopAllLsp,
  stopAllTerminals,
  stopWorkspaceHost,
  wireRegistryToElectron,
  type HostServices,
} from "@jet/host"

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
  const config = await resolveLaunchTarget([absPath], path.dirname(absPath))
  return { ...config, source: "external" }
}

function defaultCwd(): string {
  if (app.isPackaged) return os.homedir()
  return path.resolve(process.cwd())
}

function resolveLaunchConfigFast(userArgs: string[]): LaunchConfig | null | undefined {
  if (!app.isPackaged && userArgs.length === 0) return null
  if (userArgs.length === 0) return { workspacePath: defaultCwd(), source: "default" }
  if (userArgs.length === 1) {
    const raw = userArgs[0]!
    const target = path.isAbsolute(raw) ? raw : path.resolve(defaultCwd(), raw)
    try {
      const info = fs.statSync(target)
      if (info.isDirectory()) return { workspacePath: target, source: "explicit" }
    } catch {
      return null
    }
  }
  return undefined
}

function deliverLaunchConfig(config: LaunchConfig | null, notifyRenderer: boolean): void {
  launchConfig = config
  if (!notifyRenderer || !config) return
  sendToRenderer("jet:launch", config)
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
    sendToRenderer("jet:launch", config)
  }
}

function installAppMenu() {
  const closeTab = (): void => {
    sendToRenderer("jet:close-tab")
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

const DEFAULT_WINDOW_BG = "#252525"
const DEFAULT_WINDOW_FG = "#fbfbfb"

const CHROME_CACHE_PATH = path.join(app.getPath("userData"), "native-chrome.json")

function readCachedChrome(): { background: string; foreground: string } {
  try {
    const raw = fs.readFileSync(CHROME_CACHE_PATH, "utf8")
    const parsed = JSON.parse(raw) as { background?: string; foreground?: string }
    if (typeof parsed.background === "string" && typeof parsed.foreground === "string") {
      return { background: parsed.background, foreground: parsed.foreground }
    }
  } catch {
    /* first launch */
  }
  return { background: DEFAULT_WINDOW_BG, foreground: DEFAULT_WINDOW_FG }
}

function writeCachedChrome(colors: { background: string; foreground: string }): void {
  try {
    fs.mkdirSync(path.dirname(CHROME_CACHE_PATH), { recursive: true })
    fs.writeFileSync(CHROME_CACHE_PATH, JSON.stringify(colors))
  } catch (err) {
    console.warn("[jet] failed to persist native chrome cache:", err)
  }
}

function applyNativeChrome(win: BrowserWindow, colors: { background: string; foreground: string }) {
  win.setBackgroundColor(colors.background)
  writeCachedChrome(colors)
  if (process.platform === "darwin") return
  if (process.platform === "win32") {
    win.setTitleBarOverlay({
      color: colors.background,
      symbolColor: colors.foreground,
      height: 39,
    })
  }
}

function createWindow() {
  const isMac = process.platform === "darwin"
  const cachedChrome = readCachedChrome()
  const e2e = process.env.JET_E2E === "1"
  const headed = process.env.JET_HEADED === "1" || process.env.PWDEBUG === "1"
  const headlessE2e = e2e && !headed
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: !headlessE2e,
    backgroundColor: cachedChrome.background,
    titleBarStyle: isMac ? "hiddenInset" : "default",
    ...(process.platform === "win32"
      ? {
          titleBarOverlay: {
            color: cachedChrome.background,
            symbolColor: cachedChrome.foreground,
            height: 39,
          },
        }
      : {}),
    ...(isMac
      ? {
          trafficLightPosition: { x: 14, y: 11 },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  bindElectronRenderer(mainWindow.webContents)

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    if (!e2e) mainWindow.webContents.openDevTools({ mode: "detach" })
  } else if (isDev && !e2e) {
    mainWindow.loadURL("http://localhost:5173")
    mainWindow.webContents.openDevTools({ mode: "detach" })
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"))
  }

  mainWindow.on("close", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      disposeTerminalsForClient(String(mainWindow.webContents.id))
    }
    stopAllTerminals()
  })

  mainWindow.on("closed", () => {
    mainWindow = null
  })
}

if (process.env.JET_E2E === "1" && process.env.JET_E2E_USER_DATA) {
  app.setPath("userData", process.env.JET_E2E_USER_DATA)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on("second-instance", (_e, argv) => {
    const args = parseUserArgs(argv)
    if (args.length > 0) {
      void resolveLaunchTarget(args, defaultCwd()).then(config => {
        config.source = "explicit"
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.focus()
          sendToRenderer("jet:launch", config)
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
  applyLoginShellEnv()
  installAppMenu()

  const services: HostServices = {
    dialog: {
      showOpenFolderDialog: async () => {
        const result = await dialog.showOpenDialog({
          properties: ["openDirectory"],
        })
        return result.canceled ? null : result.filePaths[0] ?? null
      },
      showSaveFileDialog: async (defaultPath?: string) => {
        const result = await dialog.showSaveDialog({ defaultPath })
        return result.canceled ? null : result.filePath ?? null
      },
    },
    nativeChrome: {
      syncNativeChrome: async colors => {
        const win = getWindow()
        if (win && !win.isDestroyed()) applyNativeChrome(win, colors)
      },
    },
    launch: {
      async getLaunchConfig() {
        const config = launchConfig
        launchConfig = null
        return config
      },
      deliverLaunch(config) {
        deliverLaunchConfig(config, true)
      },
    },
    getHomeDir: () => os.homedir(),
    loadGlobalJetrcScanRoots: () => loadGlobalJetrcScanRoots(os.homedir()),
  }

  const registry = createHostRegistry(services)
  wireRegistryToElectron(ipcMain, registry)

  const userArgs = parseUserArgs(process.argv)

  createWindow()

  if (pendingLaunchPaths.length > 0) {
    const last = pendingLaunchPaths[pendingLaunchPaths.length - 1]!
    pendingLaunchPaths.length = 0
    void resolveLaunchPath(last).then(c => deliverLaunchConfig(c, true))
  } else {
    const fast = resolveLaunchConfigFast(userArgs)
    if (fast !== undefined) {
      deliverLaunchConfig(fast, false)
    } else {
      void resolveLaunchTarget(userArgs, defaultCwd()).then(c =>
        deliverLaunchConfig(
          { ...c, source: userArgs.length > 0 ? "explicit" : "default" },
          true,
        ),
      )
    }
  }
})

app.on("window-all-closed", () => {
  stopAllLsp()
  stopAllTerminals()
  stopWorkspaceHost()
  stopAllBackgroundWorkers()
  if (process.platform !== "darwin") app.quit()
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
