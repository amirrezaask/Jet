import type { GitRepositorySummary, GitWorktree } from "@yaade/shared"
import { SectionLabel } from "@yaade/ui"
import { GitBranchIcon } from "lucide-react"

export type ProjectAboutRailProps = {
  summary: GitRepositorySummary | null
  dirtyCount: number
  worktrees: GitWorktree[]
  projectPath: string
}

export function ProjectAboutRail({
  summary,
  dirtyCount,
  worktrees,
  projectPath,
}: ProjectAboutRailProps) {
  return (
    <aside
      className="hidden min-h-0 overflow-auto border-l border-border p-4 lg:block"
      data-yaade-project-about=""
    >
      <SectionLabel>About</SectionLabel>
      <dl className="grid gap-3 text-sm">
        <div>
          <dt className="text-3xs text-muted-foreground">Path</dt>
          <dd className="break-all font-mono text-xs">{projectPath}</dd>
        </div>
        <div>
          <dt className="text-3xs text-muted-foreground">Branch</dt>
          <dd className="flex items-center gap-1 font-mono text-xs">
            <GitBranchIcon className="size-3 text-muted-foreground" />
            {summary?.branch ?? "—"}
          </dd>
        </div>
        {summary?.upstream ? (
          <div>
            <dt className="text-3xs text-muted-foreground">Upstream</dt>
            <dd className="font-mono text-xs">
              {summary.upstream}
              {summary.ahead || summary.behind
                ? ` · ↑${summary.ahead} ↓${summary.behind}`
                : ""}
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="text-3xs text-muted-foreground">Working tree</dt>
          <dd className="text-xs">
            {dirtyCount === 0 ? "Clean" : `${dirtyCount} changed files`}
          </dd>
        </div>
      </dl>

      <div className="mt-8">
        <SectionLabel>Worktrees</SectionLabel>
        {worktrees.length === 0 ? (
          <p className="text-xs text-muted-foreground">None listed</p>
        ) : (
          <ul className="grid gap-2">
            {worktrees.map(tree => (
              <li
                key={tree.path}
                className="rounded-md border border-border px-2 py-1.5"
                data-yaade-worktree-row=""
              >
                <p className="truncate font-mono text-3xs text-muted-foreground">
                  {tree.branch ?? (tree.detached ? "detached" : "—")}
                </p>
                <p className="truncate text-xs">{tree.path}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
