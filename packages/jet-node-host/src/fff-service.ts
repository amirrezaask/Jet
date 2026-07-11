import { createHash } from "node:crypto"
import { homedir } from "node:os"
import path from "node:path"
import type { FileFinderApi, GrepMode } from "@ff-labs/fff-node"
import type { ProjectSearchResult } from "@jet/shared"
import { gitIsRepo } from "./git.js"
import { uriToPath } from "./paths.js"

type FileFinderModule = typeof import("@ff-labs/fff-node")

let fffModule: FileFinderModule | null = null
let fffLoadFailed = false
let fffLoadPromise: Promise<FileFinderModule | null> | null = null

async function loadFffModule(): Promise<FileFinderModule | null> {
  if (fffLoadFailed) return null
  if (fffModule) return fffModule
  if (!fffLoadPromise) {
    fffLoadPromise = (async () => {
      try {
        fffModule = await import("@ff-labs/fff-node")
        return fffModule
      } catch {
        fffLoadFailed = true
        return null
      }
    })()
  }
  return fffLoadPromise
}

export function isFffAvailable(): boolean {
  return fffModule !== null && !fffLoadFailed
}

export async function probeFffAvailable(): Promise<boolean> {
  const mod = await loadFffModule()
  return mod !== null
}

type FinderEntry = {
  finder: FileFinderApi
  rootPath: string
  ready: Promise<void>
  scanReady: boolean
}

const finders = new Map<string, FinderEntry>()
const gitRepoCache = new Map<string, boolean>()
/** Roots where FFF init failed; quick-open falls back to ripgrep immediately. */
const fffUnavailableRoots = new Set<string>()

function rootKey(rootUri: string): string {
  return path.normalize(uriToPath(rootUri))
}

async function resolveGitRepo(rootUri: string): Promise<boolean> {
  const key = rootKey(rootUri)
  const cached = gitRepoCache.get(key)
  if (cached !== undefined) return cached
  const isRepo = await gitIsRepo(rootUri)
  gitRepoCache.set(key, isRepo)
  return isRepo
}

/** Search, quick-open, and FFF indexing are git-workspace features only. */
export async function isGitWorkspace(rootUri: string): Promise<boolean> {
  return resolveGitRepo(rootUri)
}

function frecencyDbDir(rootPath: string): string {
  const hash = createHash("sha256").update(rootPath).digest("hex").slice(0, 16)
  return path.join(homedir(), ".jet", "fff", hash)
}

export async function ensureFffIndex(rootUri: string, timeoutMs = 30_000): Promise<FileFinderApi | null> {
  if (!(await resolveGitRepo(rootUri))) return null

  const mod = await loadFffModule()
  if (!mod) return null

  const rootPath = rootKey(rootUri)
  let entry = finders.get(rootPath)

  if (!entry) {
    const dbDir = frecencyDbDir(rootPath)
    const created = mod.FileFinder.create({
      basePath: rootPath,
      frecencyDbPath: path.join(dbDir, "frecency"),
      historyDbPath: path.join(dbDir, "history"),
    })
    if (!created.ok) {
      fffUnavailableRoots.add(rootPath)
      return null
    }

    const finder = created.value
    const ready = finder.waitForIndexReady(timeoutMs).then(result => {
      if (!result.ok) throw new Error(result.error)
      const e = finders.get(rootPath)
      if (e) e.scanReady = true
    })
    entry = { finder, rootPath, ready, scanReady: false }
    finders.set(rootPath, entry)
  }

  try {
    await entry.ready
    return entry.finder
  } catch {
    return null
  }
}

export function isFffScanReady(rootUri: string): boolean {
  const key = rootKey(rootUri)
  if (gitRepoCache.get(key) === false) return true
  if (fffLoadFailed || fffUnavailableRoots.has(key)) return true
  const entry = finders.get(key)
  return entry?.scanReady ?? false
}

export async function isSearchScanReady(rootUri: string): Promise<boolean> {
  if (!(await resolveGitRepo(rootUri))) return true
  return isFffScanReady(rootUri)
}

export function disposeFffIndex(rootUri: string): void {
  const rootPath = rootKey(rootUri)
  const entry = finders.get(rootPath)
  if (!entry) return
  entry.finder.destroy()
  finders.delete(rootPath)
  fffUnavailableRoots.delete(rootPath)
}

export async function fffFileSearch(
  rootUri: string,
  query: string,
  opts?: { pageSize?: number; currentFile?: string },
): Promise<string[] | null> {
  const finder = await ensureFffIndex(rootUri)
  if (!finder) return null

  const result = finder.fileSearch(query, {
    pageSize: opts?.pageSize ?? 100,
    currentFile: opts?.currentFile,
  })
  if (!result.ok) return null
  return result.value.items.map(item => item.relativePath)
}

export async function fffListFiles(rootUri: string, maxFiles = 50_000): Promise<string[] | null> {
  const finder = await ensureFffIndex(rootUri)
  if (!finder) return null

  const paths: string[] = []
  let pageIndex = 0
  const pageSize = 5000
  while (paths.length < maxFiles) {
    const result = finder.glob("**/*", { pageIndex, pageSize })
    if (!result.ok) return paths.length > 0 ? paths : null
    for (const item of result.value.items) {
      paths.push(item.relativePath)
      if (paths.length >= maxFiles) break
    }
    if (result.value.items.length < pageSize) break
    pageIndex += 1
  }
  return paths.sort()
}

export async function fffGrep(
  rootUri: string,
  query: string,
  opts?: { caseSensitive?: boolean; regex?: boolean; fuzzy?: boolean },
): Promise<ProjectSearchResult[] | null> {
  const finder = await ensureFffIndex(rootUri)
  if (!finder) return null

  let mode: GrepMode = "plain"
  if (opts?.fuzzy) mode = "fuzzy"
  else if (opts?.regex) mode = "regex"

  const result = finder.grep(query, {
    mode,
    smartCase: !opts?.caseSensitive && !opts?.fuzzy,
    pageSize: 200,
    maxMatchesPerFile: 200,
  })
  if (!result.ok) return null

  return result.value.items.map(match => ({
    path: match.relativePath,
    line: match.lineNumber,
    column: match.col + 1,
    preview: match.lineContent.trimEnd(),
  }))
}

export async function fffTrackAccess(
  rootUri: string,
  query: string,
  selectedPath: string,
): Promise<void> {
  const finder = await ensureFffIndex(rootUri)
  if (!finder) return
  finder.trackQuery(query, selectedPath)
}
