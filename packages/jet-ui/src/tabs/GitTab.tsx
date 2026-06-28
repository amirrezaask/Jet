import { useCallback, useEffect, useState } from "react"
import { PatchDiff } from "@pierre/diffs/react"
import type { GitStatusEntry } from "@jet/shared"
import type { WorkspaceService } from "@jet/workspace"
import { cn } from "../lib/utils.js"

export function GitTab({ workspace }: { workspace: WorkspaceService }) {
  const [entries, setEntries] = useState<GitStatusEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [patch, setPatch] = useState<string>("")
  const [isRepo, setIsRepo] = useState(false)

  const refresh = useCallback(async () => {
    if (!workspace.root || !window.jet?.git) return
    const repo = await window.jet.git.isRepo(workspace.root.uri)
    setIsRepo(repo)
    if (!repo) {
      setEntries([])
      return
    }
    const status = await window.jet.git.status(workspace.root.uri)
    setEntries(status)
  }, [workspace])

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

  if (!isRepo) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--jet-text-muted)]">
        Not a git repository
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="w-48 shrink-0 overflow-auto border-r border-[var(--jet-border)]">
        <div className="flex items-center justify-between border-b border-[var(--jet-border)] px-2 py-1">
          <span className="text-xs text-[var(--jet-text-muted)]">Changes</span>
          <button
            type="button"
            className="text-xs text-[var(--jet-accent)]"
            onClick={refresh}
          >
            Refresh
          </button>
        </div>
        {entries.map(e => (
          <button
            key={e.path}
            type="button"
            onClick={() => setSelected(e.path)}
            className={cn(
              "flex w-full items-center gap-2 px-2 py-1 text-left text-xs hover:bg-[var(--jet-hover)]",
              selected === e.path && "bg-[var(--jet-hover)]",
            )}
          >
            <span className="w-4 shrink-0 font-mono text-[var(--jet-accent)]">
              {statusChar(e.status)}
            </span>
            <span className="truncate">{e.path}</span>
          </button>
        ))}
      </div>
      <div className="min-w-0 flex-1 overflow-auto">
        {patch ? (
          <PatchDiff patch={patch} options={{ diffStyle: "unified" }} />
        ) : (
          <div className="p-4 text-[var(--jet-text-muted)]">
            {selected ? "No diff" : "Select a changed file"}
          </div>
        )}
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
