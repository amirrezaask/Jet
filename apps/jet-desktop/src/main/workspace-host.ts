import { Worker } from "node:worker_threads"
import path from "node:path"
import type { BrowserWindow, IpcMain, WebContents } from "electron"
import { uriToPath } from "@jet/node-host"
import { getGitWorker, getSearchWorker } from "./background-pool.js"

let activateGen = 0
let watchWorker: Worker | null = null

function workerPath(name: string): string {
  return path.join(__dirname, "workers", `${name}.js`)
}

function terminateWorker(worker: Worker | null): void {
  if (!worker) return
  void worker.terminate()
}

function stopWatchWorker(): void {
  terminateWorker(watchWorker)
  watchWorker = null
}

function sendToRenderer(webContents: WebContents, channel: string, payload: unknown): void {
  if (webContents.isDestroyed()) return
  webContents.send(channel, payload)
}

function runGitBranch(gen: number, rootUri: string, webContents: WebContents): void {
  void getGitWorker()
    .dispatch<string | null>("branch", { rootUri })
    .then(branch => {
      if (gen !== activateGen) return
      sendToRenderer(webContents, "workspace:gitBranch", { rootUri, branch })
    })
    .catch(() => {
      if (gen !== activateGen) return
      sendToRenderer(webContents, "workspace:gitBranch", { rootUri, branch: null })
    })
}

function runFileIndex(gen: number, rootUri: string, webContents: WebContents): void {
  void getSearchWorker()
    .dispatch<string[]>("listFiles", { rootUri })
    .then(files => {
      if (gen !== activateGen) return
      sendToRenderer(webContents, "workspace:fileIndex", { rootUri, files })
    })
    .catch(() => {
      if (gen !== activateGen) return
      sendToRenderer(webContents, "workspace:fileIndex", { rootUri, files: [] })
    })
}

function startWatchWorker(gen: number, rootUri: string, webContents: WebContents): void {
  stopWatchWorker()

  const rootPath = uriToPath(rootUri)
  const requestId = gen
  const worker = new Worker(workerPath("fs-watch"), {
    workerData: { rootPath, requestId },
  })
  watchWorker = worker

  worker.on(
    "message",
    (msg: { requestId: number; type: string; uri?: string; error?: string }) => {
      if (msg.requestId !== activateGen) return
      if (msg.type === "change" && msg.uri) {
        sendToRenderer(webContents, "fs:changed", msg.uri)
      }
      if (msg.type === "error") {
        console.warn("fs-watch worker error:", msg.error)
      }
    },
  )

  worker.on("error", err => {
    console.warn("fs-watch worker failed:", err)
    terminateWorker(watchWorker)
    if (watchWorker === worker) watchWorker = null
  })
}

function scheduleWorkspaceBackground(
  gen: number,
  rootUri: string,
  webContents: WebContents,
): void {
  setTimeout(() => {
    if (gen !== activateGen) return
    runGitBranch(gen, rootUri, webContents)
  }, 50)
  setTimeout(() => {
    if (gen !== activateGen) return
    runFileIndex(gen, rootUri, webContents)
  }, 2000)
  setTimeout(() => {
    if (gen !== activateGen) return
    startWatchWorker(gen, rootUri, webContents)
  }, 10_000)
}

export function registerWorkspaceHost(
  ipcMain: IpcMain,
  getWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle("workspace:activate", (_e, rootUri: string) => {
    const webContents = getWindow()?.webContents
    if (!webContents) return { ok: false }

    const gen = ++activateGen
    stopWatchWorker()
    setImmediate(() => scheduleWorkspaceBackground(gen, rootUri, webContents))
    return { ok: true }
  })
}

export function stopWorkspaceHost(): void {
  activateGen++
  stopWatchWorker()
}
