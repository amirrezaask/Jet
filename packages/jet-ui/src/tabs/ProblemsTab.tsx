import type { JetProblem } from "@jet/shared"
import { cn } from "../lib/utils.js"

export function ProblemsTab({
  problems,
  onOpenProblem,
}: {
  problems: JetProblem[]
  onOpenProblem: (problem: JetProblem) => void
}) {
  if (problems.length === 0) {
    return (
      <div className="flex h-full flex-col gap-3 p-4 text-sm text-[var(--jet-text-muted)]">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--jet-text)]">
          Problems
        </h2>
        <p>No problems reported.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-[var(--jet-border)] px-3 py-2 text-xs text-[var(--jet-text-muted)]">
        {problems.length} problem{problems.length === 1 ? "" : "s"}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {problems.map((p, i) => (
          <button
            key={`${p.uri}-${p.line}-${p.column}-${i}`}
            type="button"
            onClick={() => onOpenProblem(p)}
            className="flex w-full gap-2 border-b border-[var(--jet-border)] px-3 py-2 text-left text-xs hover:bg-[var(--jet-hover)]"
          >
            <span
              className={cn(
                "shrink-0 font-semibold uppercase",
                p.severity === "error" && "text-red-400",
                p.severity === "warning" && "text-yellow-400",
                p.severity === "info" && "text-[var(--jet-accent)]",
              )}
            >
              {p.severity[0]}
            </span>
            <span className="min-w-0 flex-1 truncate">
              <span className="text-[var(--jet-text-muted)]">{p.path}:{p.line} — </span>
              {p.message}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
