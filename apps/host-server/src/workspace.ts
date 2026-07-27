import fs from "node:fs"
import path from "node:path"
import {
  disposeFffIndex,
  ensureFffIndex,
  gitBranch,
  isGitWorkspace,
  isSearchScanReady,
  listProjectFiles,
  pathToUri,
  uriToPath,
} from "@gharargah/node-host"
import type { EventHub } from "./events.js"

const WATCH_DEBOUNCE_MS = 300
const WATCH_START_DELAY_MS = 10_000
const WATCH_IGNORE = new Set([
  "node_modules",
  ".git",
  "dist",
  "dist-electron",
  ".turbo",
  ".pnpm-store",
])

type RootState = {
  gen: number
  watchStop: { stop: boolean } | null
  watchers: fs.FSWatcher[]
}

function shouldIgnore(filePath: string): boolean {
  return filePath.split(path.sep).some(seg => WATCH_IGNORE.has(seg))
}

export class WorkspaceHost {
  private readonly roots = new Map<string, RootState>()

  activate(events: EventHub, rootUri: string): { ok: true } {
    let state = this.roots.get(rootUri)
    if (state) {
      if (state.watchStop) state.watchStop.stop = true
      for (const w of state.watchers) {
        try {
          w.close()
        } catch {
          /* ignore */
        }
      }
      state.watchers = []
      state.gen += 1
      state.watchStop = null
    } else {
      state = { gen: 1, watchStop: null, watchers: [] }
      this.roots.set(rootUri, state)
    }
    const gen = state.gen
    void this.scheduleBackground(events, rootUri, gen)
    return { ok: true }
  }

  deactivate(rootUri: string): { ok: true } {
    const state = this.roots.get(rootUri)
    if (state) {
      if (state.watchStop) state.watchStop.stop = true
      for (const w of state.watchers) {
        try {
          w.close()
        } catch {
          /* ignore */
        }
      }
      this.roots.delete(rootUri)
    }
    disposeFffIndex(rootUri)
    return { ok: true }
  }

  stopAll(): void {
    for (const uri of [...this.roots.keys()]) this.deactivate(uri)
  }

  private async scheduleBackground(events: EventHub, rootUri: string, gen: number): Promise<void> {
    await delay(50)
    if (!this.isCurrent(rootUri, gen)) return
    const branch = await gitBranch(rootUri).catch(() => null)
    events.emit("workspace:gitBranch", [{ rootUri, branch }])

    try {
      if (await isGitWorkspace(rootUri)) await ensureFffIndex(rootUri)
      await listProjectFiles(rootUri)
    } catch {
      /* warm best-effort */
    }
    if (!this.isCurrent(rootUri, gen)) return
    if ((await isSearchScanReady(rootUri)) || !(await isGitWorkspace(rootUri))) {
      events.emit("workspace:searchReady", [{ rootUri }])
    }

    await delay(WATCH_START_DELAY_MS)
    if (!this.isCurrent(rootUri, gen)) return
    this.startWatch(events, rootUri, gen)
  }

  private startWatch(events: EventHub, rootUri: string, gen: number): void {
    const state = this.roots.get(rootUri)
    if (!state || state.gen !== gen) return
    const stop = { stop: false }
    state.watchStop = stop
    const rootPath = uriToPath(rootUri)
    let pending = new Set<string>()
    let timer: NodeJS.Timeout | null = null

    const flush = () => {
      timer = null
      const batch = [...pending]
      pending = new Set()
      for (const filePath of batch) {
        if (stop.stop || !this.isCurrent(rootUri, gen)) return
        events.emit("fs:changed", [pathToUri(filePath)])
      }
    }

    const onChange = (filePath: string) => {
      if (stop.stop || shouldIgnore(filePath)) return
      pending.add(filePath)
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, WATCH_DEBOUNCE_MS)
    }

    try {
      const watcher = fs.watch(rootPath, { recursive: true }, (_event, filename) => {
        if (!filename) return
        onChange(path.join(rootPath, filename.toString()))
      })
      state.watchers.push(watcher)
    } catch {
      /* watch unsupported on some FS */
    }
  }

  private isCurrent(rootUri: string, gen: number): boolean {
    const state = this.roots.get(rootUri)
    return Boolean(state && state.gen === gen)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
