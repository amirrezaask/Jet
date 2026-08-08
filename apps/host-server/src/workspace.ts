import fs from "node:fs"
import path from "node:path"
import {
  disposeSearchRoot,
  ensureFffIndex,
  gitBranch,
  invalidateProjectFileCache,
  isGitWorkspace,
  isSearchScanReady,
  listProjectFiles,
  pathToUri,
  refreshProjectFileCache,
  uriToPath,
} from "@yaade/node-host"
import type { EventHub } from "./events.js"

const WATCH_DEBOUNCE_MS = 300
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
  owners: Set<string>
  watchStop: { stop: boolean } | null
  watchers: fs.FSWatcher[]
  knownFiles: Set<string> | null
}

export type WorkspaceLeaseOwner = {
  clientId: string
  sessionId: string
}

type WorkspaceFileChangeKind = "created" | "changed" | "deleted"

export function mergeWorkspaceFileChangeKind(
  previous: WorkspaceFileChangeKind | undefined,
  next: WorkspaceFileChangeKind,
): WorkspaceFileChangeKind {
  if (!previous || previous === next) return next
  if (previous === "deleted" && next === "created") return "changed"
  if (next === "deleted") return "deleted"
  if (previous === "created") return "created"
  return "changed"
}

function shouldIgnore(filePath: string): boolean {
  return filePath.split(path.sep).some(seg => WATCH_IGNORE.has(seg))
}

export class WorkspaceHost {
  private readonly roots = new Map<string, RootState>()
  private nextGeneration = 0

  activate(
    events: EventHub,
    rootUri: string,
    owner: WorkspaceLeaseOwner,
  ): { ok: true } {
    const ownerKey = workspaceLeaseOwnerKey(owner)
    let state = this.roots.get(rootUri)
    if (state) {
      state.owners.add(ownerKey)
      return { ok: true }
    }

    state = {
      gen: ++this.nextGeneration,
      owners: new Set([ownerKey]),
      watchStop: null,
      watchers: [],
      knownFiles: null,
    }
    this.roots.set(rootUri, state)
    const gen = state.gen
    this.startWatch(events, rootUri, gen)
    void this.scheduleBackground(events, rootUri, gen)
    return { ok: true }
  }

  deactivate(rootUri: string, owner: WorkspaceLeaseOwner): { ok: true } {
    const state = this.roots.get(rootUri)
    if (!state) return { ok: true }

    state.owners.delete(workspaceLeaseOwnerKey(owner))
    if (state.owners.size > 0) return { ok: true }

    if (state.watchStop) state.watchStop.stop = true
    for (const w of state.watchers) {
      try {
        w.close()
      } catch {
        /* ignore */
      }
    }
    this.roots.delete(rootUri)
    disposeSearchRoot(rootUri)
    return { ok: true }
  }

  stopAll(): void {
    for (const [rootUri, state] of this.roots) {
      if (state.watchStop) state.watchStop.stop = true
      for (const watcher of state.watchers) {
        try {
          watcher.close()
        } catch {
          /* ignore */
        }
      }
      disposeSearchRoot(rootUri)
    }
    this.roots.clear()
  }

  activeLeaseCount(rootUri: string): number {
    return this.roots.get(rootUri)?.owners.size ?? 0
  }

  private async scheduleBackground(events: EventHub, rootUri: string, gen: number): Promise<void> {
    await delay(50)
    if (!this.isCurrent(rootUri, gen)) return
    const branch = await gitBranch(rootUri).catch(() => null)
    events.emit("workspace:gitBranch", [{ rootUri, branch }])

    try {
      if (await isGitWorkspace(rootUri)) await ensureFffIndex(rootUri)
      const files = await listProjectFiles(rootUri)
      const rootPath = uriToPath(rootUri)
      const state = this.roots.get(rootUri)
      if (state?.gen === gen) {
        state.knownFiles = new Set(files.items.map(file => path.normalize(path.join(rootPath, file))))
      }
    } catch {
      /* warm best-effort */
    }
    if (!this.isCurrent(rootUri, gen)) return
    if ((await isSearchScanReady(rootUri)) || !(await isGitWorkspace(rootUri))) {
      events.emit("workspace:searchReady", [{ rootUri }])
    }

  }

  private startWatch(events: EventHub, rootUri: string, gen: number): void {
    const state = this.roots.get(rootUri)
    if (!state || state.gen !== gen) return
    const stop = { stop: false }
    state.watchStop = stop
    const rootPath = uriToPath(rootUri)
    let pending = new Map<string, WorkspaceFileChangeKind>()
    let timer: NodeJS.Timeout | null = null

    const flush = () => {
      timer = null
      const batch = [...pending]
      pending = new Map()
      if (stop.stop || !this.isCurrent(rootUri, gen)) return
      if (batch.length > 0) {
        invalidateProjectFileCache(rootUri)
        void refreshProjectFileCache(rootUri).catch(() => {
          /* the next Quick Open retries an interrupted best-effort refresh */
        })
      }
      for (const [filePath, kind] of batch) {
        events.emit("fs:changed", [pathToUri(filePath), kind])
      }
    }

    const onChange = (filePath: string, kind: WorkspaceFileChangeKind) => {
      if (stop.stop || shouldIgnore(filePath)) return
      pending.set(filePath, mergeWorkspaceFileChangeKind(pending.get(filePath), kind))
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, WATCH_DEBOUNCE_MS)
    }

    try {
      const watcher = fs.watch(rootPath, { recursive: true }, (event, filename) => {
        if (!filename) return
        const filePath = path.normalize(path.join(rootPath, filename.toString()))
        let kind: WorkspaceFileChangeKind = "changed"
        if (event === "rename") {
          const exists = fs.existsSync(filePath)
          const wasKnown = state.knownFiles?.has(filePath)
          kind = !exists
            ? "deleted"
            : wasKnown === false
              ? "created"
              : "changed"
          if (exists) state.knownFiles?.add(filePath)
          else state.knownFiles?.delete(filePath)
        }
        onChange(filePath, kind)
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

function workspaceLeaseOwnerKey(owner: WorkspaceLeaseOwner): string {
  return JSON.stringify([owner.clientId, owner.sessionId])
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
