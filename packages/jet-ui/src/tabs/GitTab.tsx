import { useCallback, useEffect, useState } from "react"
import { PatchDiff } from "@pierre/diffs/react"
import type { GitStatusEntry } from "@jet/shared"
import type { WorkspaceService } from "@jet/workspace"
import { cn } from "../lib/utils.js"

export function GitTab({
  workspace,
  onBranchChange,
  onGitError,
}: {
  workspace: WorkspaceService
  onBranchChange?: (branch: string | null) => void
  onGitError?: (message: string) => void
}) {
  const [entries, setEntries] = useState<GitStatusEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [patch, setPatch] = useState<string>("")
  const [isRepo, setIsRepo] = useState(false)
  const [commitMessage, setCommitMessage] = useState("")
  const [branch, setBranch] = useState<string | null>(null)
  const [branches, setBranches] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!workspace.root || !window.jet?.git) return
    const repo = await window.jet.git.isRepo(workspace.root.uri)
    setIsRepo(repo)
    if (!repo) {
      setEntries([])
      setBranch(null)
      onBranchChange?.(null)
      return
    }
    const [status, currentBranch, branchList] = await Promise.all([
      window.jet.git.status(workspace.root.uri),
      window.jet.git.branch(workspace.root.uri),
      window.jet.git.branches(workspace.root.uri),
    ])
    setEntries(status)
    setBranch(currentBranch)
    setBranches(branchList)
    onBranchChange?.(currentBranch)
  }, [workspace, onBranchChange])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!selected || !workspace.root || !window.jet?.git) {
      setPatch("")
      return
    }
    window.jet.git
      .diff(workspace.root.uri, { path: selected })
      .then(setPatch)
      .catch(() => setPatch(""))
  }, [selected, workspace.root])

  const runGit = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
      await refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      onGitError?.(`Git: ${msg}`)
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  const stage = (path: string) =>
    runGit(() => window.jet!.git.stage(workspace.root!.uri, [path]))
  const unstage = (path: string) =>
    runGit(() => window.jet!.git.unstage(workspace.root!.uri, [path]))
  const commit = () =>
    runGit(async () => {
      if (!commitMessage.trim()) return
      await window.jet!.git.commit(workspace.root!.uri, commitMessage.trim())
      setCommitMessage("")
    })
  const checkout = (b: string) =>
    runGit(() => window.jet!.git.checkout(workspace.root!.uri, b))

  if (!isRepo) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-[var(--jet-text-muted)]">
        <p>Not a git repository</p>
        <p className="text-xs">Open a folder that contains a <code>.git</code> directory.</p>
      </div>
    )
  }

  const staged = entries.filter(e => e.status !== "untracked")

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--jet-border)] px-2 py-1.5">
        <select
          value={branch ?? ""}
          onChange={e => void checkout(e.target.value)}
          disabled={busy}
          className="jet-input rounded border border-[var(--jet-border)] bg-transparent px-2 py-0.5 text-xs"
        >
          {branches.map(b => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={commitMessage}
          onChange={e => setCommitMessage(e.target.value)}
          placeholder="Commit message"
          className="jet-input min-w-[8rem] flex-1 rounded border border-[var(--jet-border)] bg-transparent px-2 py-0.5 text-xs"
        />
        <button
          type="button"
          disabled={busy || !commitMessage.trim()}
          onClick={() => void commit()}
          className="rounded px-2 py-0.5 text-xs text-[var(--jet-accent)] hover:bg-[var(--jet-hover)] disabled:opacity-40"
        >
          Commit
        </button>
        <button type="button" className="text-xs text-[var(--jet-accent)]" onClick={refresh}>
          Refresh
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div
          className="w-56 shrink-0 overflow-auto border-r border-[var(--jet-border)]"
          aria-label="Git"
          data-jet-list-panel="git"
          tabIndex={-1}
        >
          <div className="border-b border-[var(--jet-border)] px-2 py-1 text-[10px] uppercase text-[var(--jet-text-muted)]">
            Changes
          </div>
          {entries.map(e => (
            <div
              key={e.path}
              className={cn(
                "flex items-center gap-1 px-1 py-0.5 hover:bg-[var(--jet-hover)]",
                selected === e.path && "bg-[var(--jet-hover)]",
              )}
            >
              <button
                type="button"
                onClick={() => setSelected(e.path)}
                className="jet-list-item flex min-w-0 flex-1 items-center gap-2 px-1 text-left text-xs"
                data-jet-list-item
              >
                <span className="w-4 shrink-0 font-mono text-[var(--jet-accent)]">
                  {statusChar(e.status)}
                </span>
                <span className="truncate">{e.path}</span>
              </button>
              <button
                type="button"
                title="Stage"
                disabled={busy}
                onClick={() => void stage(e.path)}
                className="shrink-0 px-1 text-[10px] text-[var(--jet-text-muted)] hover:text-[var(--jet-accent)]"
              >
                Stage
              </button>
              <button
                type="button"
                title="Unstage"
                disabled={busy}
                onClick={() => void unstage(e.path)}
                className="shrink-0 px-1 text-[10px] text-[var(--jet-text-muted)] hover:text-[var(--jet-accent)]"
              >
                Unstage
              </button>
            </div>
          ))}
          {staged.length === 0 && entries.length === 0 && (
            <p className="p-2 text-xs text-[var(--jet-text-muted)]">Working tree clean</p>
          )}
        </div>
        <div className="min-w-0 flex-1 overflow-auto bg-[var(--jet-bg)] text-[var(--jet-text)]">
          {patch ? (
            <PatchDiff patch={patch} options={{ diffStyle: "unified" }} />
          ) : (
            <div className="p-4 text-[var(--jet-text-muted)]">
              {selected ? "No diff" : "Select a changed file"}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function statusChar(status: GitStatusEntry["status"]): string {
  switch (status) {
    case "modified":
      return "M"
    case "added":
      return "A"
    case "deleted":
      return "D"
    case "untracked":
      return "?"
    default:
      return " "
  }
}
