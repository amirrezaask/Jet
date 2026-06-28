import { spawn } from "node:child_process"
import type { ProjectSearchResult } from "@jet/shared"
import { uriToPath } from "./paths.js"

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

export async function listProjectFiles(rootUri: string, maxFiles = 50_000): Promise<string[]> {
  const cwd = uriToPath(rootUri)
  const args = ["--files"]
  for (const glob of IGNORE_GLOBS) args.push("--glob", glob)
  args.push(".")

  const { stdout, stderr, code } = await spawnRg(args, cwd)
  if (code !== 0 && code !== 1) {
    throw new Error(stderr.trim() || `rg exit ${code}`)
  }

  const files = stdout
    .split("\n")
    .filter(Boolean)
    .map(path => path.replace(/^\.\//, ""))
    .slice(0, maxFiles)
    .sort()
  return files
}

export async function projectSearch(
  rootUri: string,
  query: string,
  opts?: { caseSensitive?: boolean; regex?: boolean },
): Promise<ProjectSearchResult[]> {
  if (!query.trim()) return []

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
