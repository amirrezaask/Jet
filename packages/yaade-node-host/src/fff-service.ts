import { createHash } from "node:crypto"
import { homedir } from "node:os"
import path from "node:path"
import type { FileFinderApi, GrepMode } from "@ff-labs/fff-node"
import type {
  FileSearchOptions,
  ProjectSearchOptions,
  ProjectSearchResult,
  SearchPage,
} from "@yaade/shared"
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
  return path.join(homedir(), ".yaade", "fff", hash)
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
  opts?: FileSearchOptions,
): Promise<SearchPage<string> | null> {
  const finder = await ensureFffIndex(rootUri)
  if (!finder) return null

  const result = finder.fileSearch(query, {
    pageSize: opts?.pageSize ?? 100,
    currentFile: opts?.currentFile,
  })
  if (!result.ok) return null
  return {
    items: result.value.items.map(item => item.relativePath),
    truncated: result.value.totalMatched > result.value.items.length,
  }
}

export async function fffListFiles(
  rootUri: string,
  maxFiles = 20_000,
): Promise<SearchPage<string> | null> {
  const finder = await ensureFffIndex(rootUri)
  if (!finder) return null

  const paths: string[] = []
  let pageIndex = 0
  const pageSize = 5000
  let truncated = false
  while (paths.length <= maxFiles) {
    const result = finder.glob("**/*", { pageIndex, pageSize })
    if (!result.ok) {
      return paths.length > 0
        ? { items: paths.slice(0, maxFiles).sort(), truncated: true }
        : null
    }
    truncated = result.value.totalMatched > maxFiles
    for (const item of result.value.items) {
      paths.push(item.relativePath)
      if (paths.length > maxFiles) break
    }
    if (paths.length > maxFiles || result.value.items.length < pageSize) break
    pageIndex += 1
  }
  return { items: paths.slice(0, maxFiles).sort(), truncated }
}

export async function fffGrep(
  rootUri: string,
  query: string,
  opts?: ProjectSearchOptions,
): Promise<SearchPage<ProjectSearchResult> | null> {
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

  const items = result.value.items.map(match => {
    const preview = match.lineContent.replace(/\r?\n$/, "")
    const ranges = match.matchRanges.map(([start, end]) => ({
      startLine: match.lineNumber,
      startColumn: byteColumn(preview, start),
      endLine: match.lineNumber,
      endColumn: byteColumn(preview, end),
    }))
    return {
      path: match.relativePath,
      line: match.lineNumber,
      column: ranges[0]?.startColumn ?? byteColumn(preview, match.col),
      preview,
      ranges,
    }
  })
  return { items, truncated: result.value.nextCursor !== null }
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

function byteColumn(text: string, byteOffset: number): number {
  const bytes = Buffer.from(text, "utf8")
  return bytes.subarray(0, Math.max(0, Math.min(byteOffset, bytes.length))).toString("utf8").length + 1
}
