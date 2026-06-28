import { spawn } from "node:child_process"
import type { ProjectSearchResult } from "@jet/shared"
import { uriToPath } from "./paths.js"

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
