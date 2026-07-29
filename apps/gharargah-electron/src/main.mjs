#!/usr/bin/env node
/**
 * Thin Electron shell: spawn TS host/agent (+ Vite in --dev), load the shared web SPA.
 * A narrow preload bridge lets Settings select the bundled server or a remote Gharargah origin.
 *
 * Packaged (DMG): backends + Node live under process.resourcesPath/gharargah.
 * Dev / repo prod: spawn from monorepo via tsx (same as pnpm electron).
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { app, BrowserWindow, ipcMain } from "electron"
import {
  DEFAULT_HOST,
  DEFAULT_HOST_PORT,
  DEFAULT_VITE_PORT,
  isPackagedRuntime,
  spawnAgentServer,
  spawnHostServer,
  spawnVite,
  waitForUrl,
  wireChildLifecycle,
} from "./spawn-backend.mjs"
import {
  normalizeServerUrl,
  readServerSelection,
  SERVER_SELECTION_FILENAME,
  writeServerSelection,
} from "./server-selection.mjs"

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const repoRoot = path.resolve(packageDir, "../..")
const gharargahAppDir = path.resolve(repoRoot, "apps/gharargah")
const iconPath = path.join(
  packageDir,
  "assets",
  process.platform === "darwin" ? "icon.icns" : "icon.png",
)

const isDev = process.argv.includes("--dev") || process.env.GHARARGAH_ELECTRON_DEV === "1"
const hostPort = Number(process.env.JET_PORT ?? DEFAULT_HOST_PORT)
const host = process.env.JET_HOST ?? DEFAULT_HOST
const vitePort = Number(process.env.JET_WEB_PORT ?? DEFAULT_VITE_PORT)
const localServerUrl = `http://${host}:${hostPort}`
const localAppUrl = isDev ? `http://${host}:${vitePort}` : localServerUrl

/** @returns {string | undefined} */
function resolveRuntimeRoot() {
  if (app.isPackaged) {
    const packaged = path.join(process.resourcesPath, "gharargah")
    if (isPackagedRuntime(packaged)) return packaged
  }
  // Local unpack smoke: GHARARGAH_RUNTIME_ROOT=/path/to/pack
  const fromEnv = process.env.GHARARGAH_RUNTIME_ROOT
  if (fromEnv && isPackagedRuntime(fromEnv)) return fromEnv
  return undefined
}

/**
 * Optional folder/file path after flags → host-server launch config.
 * With no path, host uses its cwd (repo root) via spawnHostServer.
 */
function launchPathFromArgv() {
  const skip = new Set(["--dev"])
  for (const arg of process.argv.slice(1)) {
    if (arg.startsWith("-")) {
      if (skip.has(arg)) continue
      continue
    }
    // Skip electron binary path and the app entry (package dir / main.mjs).
    if (arg === "." || arg === packageDir) continue
    if (arg.endsWith("main.mjs") || arg.includes(`${path.sep}electron`)) continue
    if (path.isAbsolute(arg) || arg.includes("/") || arg.includes("\\")) {
      return path.resolve(arg)
    }
  }
  return undefined
}

async function urlReady(url) {
  try {
    const res = await fetch(url)
    return res.ok || res.status === 404
  } catch {
    return false
  }
}

const children = []
let stopChildren = () => {}
let localBackendsReady = false
let activeServerUrl = localServerUrl
let startupError = null

async function ensureLocalBackends() {
  if (localBackendsReady) return
  const healthUrl = `http://${host}:${hostPort}/health`
  const viteUrl = `http://${host}:${vitePort}/`
  const hostUp = await urlReady(healthUrl)
  const viteUp = isDev ? await urlReady(viteUrl) : true
  const runtimeRoot = resolveRuntimeRoot()

  if (!hostUp) {
    const launchPath = launchPathFromArgv()
    children.push(
      spawnHostServer({
        repoRoot,
        runtimeRoot,
        host,
        port: hostPort,
        launchPath,
      }),
    )
    if (process.env.GHARARGAH_ENABLE_AGENT_CHAT === "1") {
      children.push(spawnAgentServer({ repoRoot, runtimeRoot }))
    }
  }
  if (isDev && !viteUp) {
    children.push(spawnVite({ appDir: gharargahAppDir }))
  }

  if (children.length > 0) {
    const lifecycle = wireChildLifecycle(children, { exitProcess: false })
    stopChildren = lifecycle.stop
  }

  await waitForUrl(healthUrl)
  if (isDev) await waitForUrl(viteUrl)
  localBackendsReady = true
}

function healthUrl(serverUrl) {
  return new URL("/health", `${serverUrl}/`).toString()
}

async function waitForGharargahServer(serverUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const response = await fetch(healthUrl(serverUrl))
      if (response.ok) {
        const payload = await response.json()
        if (payload?.status === "ok") return
      }
      lastError = new Error(`Health check returned HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  const detail = lastError instanceof Error ? `: ${lastError.message}` : ""
  throw new Error(`Could not reach a Gharargah server at ${serverUrl}${detail}`)
}

function serverConnection() {
  return {
    activeUrl: activeServerUrl,
    localUrl: localServerUrl,
    mode: activeServerUrl === localServerUrl ? "local" : "remote",
    startupError,
  }
}

function queueWindowNavigation(serverUrl) {
  const targetUrl = serverUrl === localServerUrl ? localAppUrl : serverUrl
  setTimeout(() => {
    for (const win of BrowserWindow.getAllWindows()) {
      void win.loadURL(targetUrl)
    }
  }, 0)
}

async function selectInitialServer(configPath) {
  const selectedServerUrl = readServerSelection(configPath)
  if (selectedServerUrl) {
    try {
      await waitForGharargahServer(selectedServerUrl, 5_000)
      activeServerUrl = selectedServerUrl
      return selectedServerUrl
    } catch (error) {
      startupError = error instanceof Error ? error.message : String(error)
      console.error(`[gharargah-electron] ${startupError}; falling back to bundled server`)
    }
  }
  await ensureLocalBackends()
  activeServerUrl = localServerUrl
  return localAppUrl
}

function registerServerIpc(configPath) {
  ipcMain.handle("gharargah:server:get", () => serverConnection())
  ipcMain.handle("gharargah:server:connect", async (_event, requestedUrl) => {
    const remoteUrl =
      typeof requestedUrl === "string" && requestedUrl.trim()
        ? normalizeServerUrl(requestedUrl)
        : null

    if (remoteUrl) {
      await waitForGharargahServer(remoteUrl, 10_000)
      writeServerSelection(configPath, remoteUrl)
      activeServerUrl = remoteUrl
    } else {
      await ensureLocalBackends()
      writeServerSelection(configPath, null)
      activeServerUrl = localServerUrl
    }
    startupError = null
    const connection = serverConnection()
    queueWindowNavigation(activeServerUrl)
    return connection
  })
}

function createWindow(url) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 560,
    title: "Gharargah",
    icon: iconPath,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(packageDir, "src", "preload.cjs"),
    },
  })

  win.once("ready-to-show", () => win.show())
  void win.loadURL(url)
  return win
}

app.whenReady().then(async () => {
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(path.join(packageDir, "assets", "icon.png"))
  }
  const configPath = path.join(app.getPath("userData"), SERVER_SELECTION_FILENAME)
  registerServerIpc(configPath)
  let initialUrl
  try {
    initialUrl = await selectInitialServer(configPath)
  } catch (err) {
    console.error("[gharargah-electron] backend startup failed:", err)
    stopChildren()
    app.exit(1)
    return
  }
  createWindow(initialUrl)
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(activeServerUrl === localServerUrl ? localAppUrl : activeServerUrl)
    }
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("before-quit", () => {
  stopChildren("SIGTERM")
})
