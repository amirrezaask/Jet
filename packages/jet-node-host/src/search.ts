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
} from "./fff-service.js"

const IGNORE_GLOBS = [
  "!.git/**",
  "!node_modules/**",
  "!dist/**",
  "!dist-electron/**",
  "!.turbo/**",
]

function spawnRg(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("rg", args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    proc.stdout.on("data", d => (stdout += d))
    proc.stderr.on("data", d => (stderr += d))
    proc.on("close", code => resolve({ stdout, stderr, code }))
    proc.on("error", err => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("ripgrep (rg) is not installed or not on PATH"))
      } else {
        reject(err)
      }
    })
  })
}

async function rgListProjectFiles(rootUri: string, maxFiles = 50_000): Promise<string[]> {
  const cwd = uriToPath(rootUri)
  const args = ["--files"]
  for (const glob of IGNORE_GLOBS) args.push("--glob", glob)
  args.push(".")

  const { stdout, stderr, code } = await spawnRg(args, cwd)
  if (code !== 0 && code !== 1) {
    throw new Error(stderr.trim() || `rg exit ${code}`)
  }

  return stdout
    .split("\n")
    .filter(Boolean)
    .map(p => p.replace(/^\.\//, ""))
    .slice(0, maxFiles)
    .sort()
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
  args.push(query, ".")

  return new Promise((resolve, reject) => {
    const proc = spawn("rg", args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    proc.stdout.on("data", d => (stdout += d))
    proc.stderr.on("data", d => (stderr += d))
    proc.on("close", code => {
      if (code === 0 || code === 1) {
        resolve(parseRgJson(stdout))
      } else {
        reject(new Error(stderr.trim() || `rg exit ${code}`))
      }
    })
    proc.on("error", err => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("ripgrep (rg) is not installed or not on PATH"))
      } else {
        reject(err)
      }
    })
  })
}

export async function trackFileAccess(
  rootUri: string,
  query: string,
  selectedPath: string,
): Promise<void> {
  try {
    await fffTrackAccess(rootUri, query, selectedPath)
  } catch {
    /* optional frecency tracking */
  }
}

export { ensureFffIndex, isFffScanReady }

function parseRgJson(output: string): ProjectSearchResult[] {
  const results: ProjectSearchResult[] = []
  for (const line of output.split("\n")) {
    if (!line.trim()) continue
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
      if (obj.type !== "match" || !obj.data) continue
      const path = obj.data.path?.text ?? ""
      const lineNum = obj.data.line_number ?? 1
      const sub = obj.data.submatches?.[0]
      const column = (sub?.start ?? 0) + 1
      const preview = (obj.data.lines?.text ?? "").trimEnd()
      results.push({ path, line: lineNum, column, preview })
    } catch {
      /* skip malformed line */
    }
  }
  return results
}
