import { Worker } from "node:worker_threads"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ensureFffIndex, isGitWorkspace, isSearchScanReady, uriToPath } from "@jet/node-host"
import { getGitWorker } from "./background-pool.js"
import { sendToRenderer } from "./host-renderer.js"
import type { HostRegistry } from "./registry.js"

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

type RootHostState = {
  gen: number
  watchWorker: Worker | null
}

const activeRoots = new Map<string, RootHostState>()

function workerPath(name: string): string {
  return path.join(moduleDir, "workers", `${name}.js`)
}

function terminateWorker(worker: Worker | null): void {
  if (!worker) return
  void worker.terminate()
}

function stopWatchWorker(state: RootHostState): void {
  terminateWorker(state.watchWorker)
  state.watchWorker = null
}

function runGitBranch(gen: number, rootUri: string): void {
  void getGitWorker()
    .dispatch<string | null>("branch", { rootUri })
    .then(branch => {
      const state = activeRoots.get(rootUri)
      if (!state || gen !== state.gen) return
      sendToRenderer("workspace:gitBranch", { rootUri, branch })
    })
    .catch(() => {
      const state = activeRoots.get(rootUri)
      if (!state || gen !== state.gen) return
      sendToRenderer("workspace:gitBranch", { rootUri, branch: null })
    })
}

function runFffWarmup(gen: number, rootUri: string): void {
  void (async () => {
    if (!(await isGitWorkspace(rootUri))) return

    if (await isSearchScanReady(rootUri)) {
      const state = activeRoots.get(rootUri)
      if (!state || gen !== state.gen) return
      sendToRenderer("workspace:searchReady", { rootUri })
      return
    }
    await ensureFffIndex(rootUri)
    const state = activeRoots.get(rootUri)
    if (!state || gen !== state.gen) return
    if (await isSearchScanReady(rootUri)) {
      sendToRenderer("workspace:searchReady", { rootUri })
    }
  })().catch(() => {
    const state = activeRoots.get(rootUri)
    if (!state || gen !== state.gen) return
  })
}

function startWatchWorker(state: RootHostState, rootUri: string): void {
  stopWatchWorker(state)

  const rootPath = uriToPath(rootUri)
  const requestId = state.gen
  const worker = new Worker(workerPath("fs-watch"), {
    workerData: { rootPath, requestId },
  })
  state.watchWorker = worker

  worker.on(
    "message",
    (msg: { requestId: number; type: string; uri?: string; error?: string }) => {
      const current = activeRoots.get(rootUri)
      if (!current || msg.requestId !== current.gen) return
      if (msg.type === "change" && msg.uri) {
        sendToRenderer("fs:changed", msg.uri)
      }
      if (msg.type === "error") {
        console.warn("fs-watch worker error:", msg.error)
      }
    },
  )

  worker.on("error", err => {
    console.warn("fs-watch worker failed:", err)
    terminateWorker(worker)
    const current = activeRoots.get(rootUri)
    if (current?.watchWorker === worker) current.watchWorker = null
  })
}

function scheduleWorkspaceBackground(state: RootHostState, rootUri: string): void {
  const gen = state.gen
  setTimeout(() => {
    const current = activeRoots.get(rootUri)
    if (!current || current.gen !== gen) return
    runGitBranch(gen, rootUri)
  }, 50)
  setTimeout(() => {
    const current = activeRoots.get(rootUri)
    if (!current || current.gen !== gen) return
    runFffWarmup(gen, rootUri)
  }, 50)
  setTimeout(() => {
    const current = activeRoots.get(rootUri)
    if (!current || current.gen !== gen) return
    startWatchWorker(current, rootUri)
  }, 10_000)
}

export function registerWorkspaceHost(registry: HostRegistry): void {
  registry.handle("workspace:activate", async args => {
    const rootUri = args[0] as string
    let state = activeRoots.get(rootUri)
    if (state) {
      state.gen += 1
      scheduleWorkspaceBackground(state, rootUri)
      return { ok: true }
    }

    state = { gen: 1, watchWorker: null }
    activeRoots.set(rootUri, state)
    setImmediate(() => scheduleWorkspaceBackground(state!, rootUri))
    return { ok: true }
  })

  registry.handle("workspace:deactivate", async args => {
    const rootUri = args[0] as string
    const state = activeRoots.get(rootUri)
    if (!state) return { ok: true }
    stopWatchWorker(state)
    activeRoots.delete(rootUri)
    return { ok: true }
  })
}

export function stopWorkspaceHost(): void {
  for (const state of activeRoots.values()) {
    stopWatchWorker(state)
  }
  activeRoots.clear()
}
