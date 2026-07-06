import { spawn } from "node:child_process"
import type { ProjectSearchResult } from "@jet/shared"
import { uriToPath } from "./paths.js"
import {
  ensureFffIndex,
  fffFileSearch,
  fffGrep,
  fffListFiles,
  fffTrackAccess,
  isFffScanReady,
  isGitWorkspace,
  isSearchScanReady,
} from "./fff-service.js"

const IGNORE_GLOBS = [
  "!.git/**",
  "!node_modules/**",
  "!dist/**",
  "!dist-electron/**",
  "!.turbo/**",
]

/** Cap ripgrep stdout so V8 never builds a multi-hundred-MB string (RangeError). */
const MAX_RG_STDOUT_BYTES = 32 * 1024 * 1024
const MAX_RG_STDERR_BYTES = 64 * 1024
const MAX_RG_MATCH_RESULTS = 200

function appendBounded(current: string, chunk: Buffer, maxBytes: number): string | null {
  if (current.length >= maxBytes) return null
  try {
    const next = current + chunk.toString("utf8")
    return next.length <= maxBytes ? next : null
  } catch {
    return null
  }
}

function spawnRgLines(
  args: string[],
  cwd: string,
  onLine: (line: string) => boolean,
  opts?: { maxStdoutBytes?: number },
): Promise<{ stderr: string; code: number | null; stoppedEarly: boolean }> {
  const maxStdoutBytes = opts?.maxStdoutBytes ?? MAX_RG_STDOUT_BYTES
  return new Promise((resolve, reject) => {
    const proc = spawn("rg", args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    let lineBuffer = ""
    let stderr = ""
    let stdoutBytes = 0
    let stoppedEarly = false

    const stop = (): void => {
      stoppedEarly = true
      proc.kill()
    }

    proc.stdout.on("data", (chunk: Buffer) => {
      try {
        stdoutBytes += chunk.length
        if (stdoutBytes > maxStdoutBytes) {
          stop()
          return
        }
        const merged = appendBounded(lineBuffer, chunk, maxStdoutBytes)
        if (merged === null) {
          stop()
          return
        }
        lineBuffer = merged

        let newlineAt = lineBuffer.indexOf("\n")
        while (newlineAt >= 0) {
          const line = lineBuffer.slice(0, newlineAt)
          lineBuffer = lineBuffer.slice(newlineAt + 1)
          if (!onLine(line)) {
            stop()
            return
          }
          newlineAt = lineBuffer.indexOf("\n")
        }

        if (lineBuffer.length > 1024 * 1024) {
          stop()
        }
      } catch {
        stop()
      }
    })

    proc.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length >= MAX_RG_STDERR_BYTES) return
      const merged = appendBounded(stderr, chunk, MAX_RG_STDERR_BYTES)
      if (merged !== null) stderr = merged
    })

    proc.on("close", code => resolve({ stderr, code, stoppedEarly }))
    proc.on("error", err => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("ripgrep (rg) is not installed or not on PATH"))
      } else {
        reject(err)
      }
    })
  })
}

function pushIgnoreGlobs(args: string[]): void {
  for (const glob of IGNORE_GLOBS) args.push("--glob", glob)
}

async function rgListProjectFiles(rootUri: string, maxFiles = 50_000): Promise<string[]> {
  const cwd = uriToPath(rootUri)
  const args = ["--files"]
  pushIgnoreGlobs(args)
  args.push(".")

  const paths: string[] = []
  const { stderr, code, stoppedEarly } = await spawnRgLines(args, cwd, line => {
    if (!line) return true
    paths.push(line.replace(/^\.\//, ""))
    return paths.length < maxFiles
  })

  if (!stoppedEarly && code !== 0 && code !== 1) {
    throw new Error(stderr.trim() || `rg exit ${code}`)
  }

  return paths.sort()
}

function scoreFileTerm(term: string, filePath: string, base: string): number | null {
  const lower = filePath.toLowerCase()
  const idx = lower.indexOf(term)
  if (idx >= 0) {
    let score = idx
    if (base.startsWith(term)) score -= 100
    if (base === term) score -= 200
    const baseIdx = base.indexOf(term)
    if (baseIdx >= 0) score -= 50
    return score
  }
  return null
}

function fuzzyMatchFilesFallback(query: string, files: string[], limit = 100): string[] {
  const trimmed = query.trim()
  if (!trimmed) return files.slice(0, limit)

  const terms = trimmed.toLowerCase().split(/\s+/).filter(Boolean)
  const scored: { path: string; score: number }[] = []

  for (const filePath of files) {
    const lower = filePath.toLowerCase()
    const base = (filePath.split("/").pop() ?? filePath).toLowerCase()
    let total = 0
    let matched = true
    for (const term of terms) {
      const s = scoreFileTerm(term, lower, base)
      if (s === null) {
        matched = false
        break
      }
      total += s
    }
    if (matched) scored.push({ path: filePath, score: total })
  }

  scored.sort((a, b) => a.score - b.score || a.path.localeCompare(b.path))
  return scored.slice(0, limit).map(s => s.path)
}

export async function listProjectFiles(rootUri: string, maxFiles = 50_000): Promise<string[]> {
  if (!(await isGitWorkspace(rootUri))) return []

  try {
    const fffFiles = await fffListFiles(rootUri, maxFiles)
    if (fffFiles) return fffFiles
  } catch {
    /* fall through to rg */
  }
  return rgListProjectFiles(rootUri, maxFiles)
}

export async function fileSearch(
  rootUri: string,
  query: string,
  opts?: { pageSize?: number; currentFile?: string },
): Promise<string[]> {
  if (!(await isGitWorkspace(rootUri))) return []

  try {
    const fffResults = await fffFileSearch(rootUri, query, opts)
    if (fffResults) return fffResults
  } catch {
    /* fall through */
  }
  const files = await rgListProjectFiles(rootUri)
  return fuzzyMatchFilesFallback(query, files, opts?.pageSize ?? 100)
}

export async function projectSearch(
  rootUri: string,
  query: string,
  opts?: { caseSensitive?: boolean; regex?: boolean; fuzzy?: boolean },
): Promise<ProjectSearchResult[]> {
  if (!query.trim()) return []
  if (!(await isGitWorkspace(rootUri))) return []

  try {
    const fffResults = await fffGrep(rootUri, query, opts)
    if (fffResults) return fffResults
  } catch {
    /* fall through */
  }

  const cwd = uriToPath(rootUri)
  const args = ["--json", "--max-count", "200"]
  if (!opts?.caseSensitive) args.push("-i")
  if (opts?.regex) args.push("--regexp")
  else args.push("--fixed-strings")
  pushIgnoreGlobs(args)
  args.push(query, ".")

  const results: ProjectSearchResult[] = []
  const { stderr, code, stoppedEarly } = await spawnRgLines(args, cwd, line => {
    const match = parseRgJsonLine(line)
    if (match) results.push(match)
    return results.length < MAX_RG_MATCH_RESULTS
  })

  if (!stoppedEarly && code !== 0 && code !== 1) {
    throw new Error(stderr.trim() || `rg exit ${code}`)
  }
  return results
}

export async function trackFileAccess(
  rootUri: string,
  query: string,
  selectedPath: string,
): Promise<void> {
  if (!(await isGitWorkspace(rootUri))) return
  try {
    await fffTrackAccess(rootUri, query, selectedPath)
  } catch {
    /* optional frecency tracking */
  }
}

export { ensureFffIndex, isFffScanReady, isGitWorkspace, isSearchScanReady }

function parseRgJsonLine(line: string): ProjectSearchResult | null {
  if (!line.trim()) return null
  try {
    const obj = JSON.parse(line) as {
      type?: string
      data?: {
        path?: { text?: string }
        line_number?: number
        submatches?: { start?: number; match?: { text?: string } }[]
        lines?: { text?: string }
      }
    }
    if (obj.type !== "match" || !obj.data) return null
    const path = obj.data.path?.text ?? ""
    const lineNum = obj.data.line_number ?? 1
    const sub = obj.data.submatches?.[0]
    const column = (sub?.start ?? 0) + 1
    const preview = (obj.data.lines?.text ?? "").trimEnd()
    return { path, line: lineNum, column, preview }
  } catch {
    return null
  }
}
