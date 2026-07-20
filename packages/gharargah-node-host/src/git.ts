import { spawn } from "node:child_process"
import type { GitStatusEntry, GitFileStatus } from "@gharargah/shared"
import { uriToPath } from "./paths.js"

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

export async function gitIsRepo(rootUri: string): Promise<boolean> {
  try {
    await runGit(uriToPath(rootUri), ["rev-parse", "--is-inside-work-tree"])
    return true
  } catch {
    return false
  }
}

export async function gitStatus(rootUri: string): Promise<GitStatusEntry[]> {
  const out = await runGit(uriToPath(rootUri), ["status", "--porcelain", "-u"])
  return parseStatus(out)
}

export async function gitDiff(
  rootUri: string,
  opts?: { path?: string; staged?: boolean },
): Promise<string> {
  const args = ["diff"]
  if (opts?.staged) args.push("--cached")
  if (opts?.path) args.push("--", opts.path)
  return runGit(uriToPath(rootUri), args)
}

export async function gitBranch(rootUri: string): Promise<string | null> {
  try {
    const out = await runGit(uriToPath(rootUri), ["rev-parse", "--abbrev-ref", "HEAD"])
    const branch = out.trim()
    return branch || null
  } catch {
    return null
  }
}

export async function gitStage(rootUri: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  await runGit(uriToPath(rootUri), ["add", "--", ...paths])
}

export async function gitUnstage(rootUri: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  await runGit(uriToPath(rootUri), ["restore", "--staged", "--", ...paths])
}

export async function gitCommit(rootUri: string, message: string): Promise<void> {
  await runGit(uriToPath(rootUri), ["commit", "-m", message])
}

export async function gitBranches(rootUri: string): Promise<string[]> {
  const out = await runGit(uriToPath(rootUri), ["branch", "--format=%(refname:short)"])
  return out
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean)
}

export async function gitCheckout(rootUri: string, branch: string): Promise<void> {
  await runGit(uriToPath(rootUri), ["checkout", branch])
}
