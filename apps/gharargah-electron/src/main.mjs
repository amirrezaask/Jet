#!/usr/bin/env node
/**
 * Thin Electron shell: spawn TS host/agent (+ Vite in --dev), load the shared web SPA.
 * No preload, no separate renderer entry — same packages/gharargah-app main.tsx as the browser.
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { app, BrowserWindow } from "electron"
import {
  DEFAULT_HOST,
  DEFAULT_HOST_PORT,
  DEFAULT_VITE_PORT,
  spawnAgentServer,
  spawnHostServer,
  spawnVite,
  waitForUrl,
  wireChildLifecycle,
} from "../../gharargah/scripts/spawn-backend.mjs"

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

async function startBackends() {
  const healthUrl = `http://${host}:${hostPort}/health`
  const viteUrl = `http://${host}:${vitePort}/`
  const hostUp = await urlReady(healthUrl)
  const viteUp = isDev ? await urlReady(viteUrl) : true

  if (!hostUp) {
    const launchPath = launchPathFromArgv()
    children.push(
      spawnHostServer({
        repoRoot,
        host,
        port: hostPort,
        launchPath,
      }),
    )
    children.push(spawnAgentServer({ repoRoot }))
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
}

function createWindow() {
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
    },
  })

  const url = isDev ? `http://${host}:${vitePort}/` : `http://${host}:${hostPort}/`

  win.once("ready-to-show", () => win.show())
  void win.loadURL(url)
  return win
}

app.whenReady().then(async () => {
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(path.join(packageDir, "assets", "icon.png"))
  }
  try {
    await startBackends()
  } catch (err) {
    console.error("[gharargah-electron] backend startup failed:", err)
    stopChildren()
    app.exit(1)
    return
  }
  createWindow()
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("before-quit", () => {
  stopChildren("SIGTERM")
})
