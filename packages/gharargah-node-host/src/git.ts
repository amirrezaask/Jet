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
    const conflict = code.includes("U") || code === "AA" || code === "DD"
    if (conflict) status = "conflict"
    else if (code === "??") status = "untracked"
    else if (code.includes("A")) status = "added"
    else if (code.includes("D")) status = "deleted"
    else if (code.includes("R")) status = "renamed"
    const staged = index !== " " && index !== "?"
    const unstaged = work !== " " || code === "??"
    entries.push({
      path: filePath,
      status,
      originalPath,
      staged,
      unstaged,
      indexStatus: staged ? statusForChar(index) : undefined,
      worktreeStatus: unstaged ? statusForChar(work) : undefined,
    })
  }
  return entries
}

function statusForChar(code: string): GitFileStatus {
  if (code === "?") return "untracked"
  if (code === "A") return "added"
  if (code === "D") return "deleted"
  if (code === "R") return "renamed"
  if (code === "U") return "conflict"
  return "modified"
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

export type GitShowRef = "HEAD" | "INDEX"

/** Read file content at HEAD or the index (`:`) for diff viewers. */
export async function gitShow(
  rootUri: string,
  path: string,
  ref: GitShowRef,
): Promise<string> {
  const spec = ref === "INDEX" ? `:${path}` : `HEAD:${path}`
  try {
    return await runGit(uriToPath(rootUri), ["show", spec])
  } catch {
    return ""
  }
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

export async function gitCommitWithBody(
  rootUri: string,
  summary: string,
  body?: string,
): Promise<void> {
  const args = ["commit", "-m", summary]
  if (body?.trim()) args.push("-m", body.trim())
  await runGit(uriToPath(rootUri), args)
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

export async function gitDiscard(rootUri: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  await runGit(uriToPath(rootUri), ["restore", "--worktree", "--", ...paths])
}

export async function gitFetch(rootUri: string): Promise<void> {
  await runGit(uriToPath(rootUri), ["fetch"])
}

export async function gitPull(rootUri: string): Promise<void> {
  await runGit(uriToPath(rootUri), ["pull"])
}

export async function gitPush(rootUri: string): Promise<void> {
  await runGit(uriToPath(rootUri), ["push"])
}

export type GitSummary = {
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
}

export async function gitSummary(rootUri: string): Promise<GitSummary> {
  const cwd = uriToPath(rootUri)
  const branch = await gitBranch(rootUri)
  let upstream: string | null = null
  try {
    const out = await runGit(cwd, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ])
    const trimmed = out.trim()
    upstream = trimmed || null
  } catch {
    upstream = null
  }
  let ahead = 0
  let behind = 0
  if (upstream) {
    try {
      const counts = await runGit(cwd, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"])
      const parts = counts.trim().split(/\s+/)
      behind = Number.parseInt(parts[0] ?? "0", 10) || 0
      ahead = Number.parseInt(parts[1] ?? "0", 10) || 0
    } catch {
      /* ignore */
    }
  }
  return { branch, upstream, ahead, behind }
}

export type GitHistoryCommit = {
  hash: string
  shortHash: string
  author: string
  authoredAt: number
  subject: string
}

export async function gitHistory(rootUri: string, limit = 50): Promise<GitHistoryCommit[]> {
  const capped = Math.min(Math.max(limit, 1), 200)
  const out = await runGit(uriToPath(rootUri), [
    "log",
    `-n${capped}`,
    "--format=%H%x1f%h%x1f%an%x1f%at%x1f%s%x1e",
  ])
  const commits: GitHistoryCommit[] = []
  for (const record of out.split("\u001e")) {
    const trimmed = record.trim()
    if (!trimmed) continue
    const fields = trimmed.split("\u001f")
    const hash = fields[0]
    const shortHash = fields[1]
    const author = fields[2]
    if (!hash || !shortHash || !author) continue
    const authoredAt = (Number.parseInt(fields[3] ?? "0", 10) || 0) * 1000
    const subject = fields[4] ?? ""
    commits.push({ hash, shortHash, author, authoredAt, subject })
  }
  return commits
}
