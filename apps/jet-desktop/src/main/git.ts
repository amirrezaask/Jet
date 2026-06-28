import type { IpcMain } from "electron"
import { spawn } from "node:child_process"
import type { GitStatusEntry, GitFileStatus } from "@jet/shared"

function uriToPath(uri: string): string {
  if (uri.startsWith("file://")) {
    const p = decodeURIComponent(uri.slice(7))
    return process.platform === "win32" && p.startsWith("/") ? p.slice(1) : p
  }
  return uri
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    proc.stdout.on("data", d => (stdout += d))
    proc.stderr.on("data", d => (stderr += d))
    proc.on("close", code => {
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr || `git exit ${code}`))
    })
  })
}

function parseStatus(output: string): GitStatusEntry[] {
  const entries: GitStatusEntry[] = []
  for (const line of output.split("\n")) {
    if (!line.trim()) continue
    const index = line[0]
    const work = line[1]
    const rest = line.slice(3).trim()
    let filePath = rest
    let originalPath: string | undefined
    if (rest.includes(" -> ")) {
      const parts = rest.split(" -> ")
      originalPath = parts[0]
      filePath = parts[1] ?? rest
    }
    const code = `${index}${work}`
    let status: GitFileStatus = "modified"
    if (code === "??") status = "untracked"
    else if (code.includes("A")) status = "added"
    else if (code.includes("D")) status = "deleted"
    else if (code.includes("R")) status = "renamed"
    else if (code.includes("U")) status = "conflict"
    entries.push({ path: filePath, status, originalPath })
  }
  return entries
}

export function registerGitHandlers(ipcMain: IpcMain) {
  ipcMain.handle("git:isRepo", async (_e, rootUri: string) => {
    try {
      await runGit(uriToPath(rootUri), ["rev-parse", "--is-inside-work-tree"])
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle("git:status", async (_e, rootUri: string) => {
    const out = await runGit(uriToPath(rootUri), ["status", "--porcelain", "-u"])
    return parseStatus(out)
  })

  ipcMain.handle(
    "git:diff",
    async (_e, rootUri: string, opts?: { path?: string; staged?: boolean }) => {
      const args = ["diff"]
      if (opts?.staged) args.push("--cached")
      if (opts?.path) args.push("--", opts.path)
      return runGit(uriToPath(rootUri), args)
    },
  )
}
