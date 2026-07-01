import type { WorkspaceService } from "@jet/workspace"
import { useEffect, useRef, useState } from "react"

export function OutputPanel({ workspace }: { workspace: WorkspaceService }) {
  useStateRev(workspace.taskRunner)
  const run = workspace.taskRunner.activeRun()
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [run?.output])

  return (
    <div className="flex h-full min-h-0 flex-col" data-jet-list-panel="output">
      <div className="shrink-0 border-b border-[var(--jet-border)] px-2 py-1 text-[length:var(--jet-fs-xs)] uppercase tracking-wide text-[var(--jet-text-muted)]">
        Output {run ? `— ${run.task.label} (${run.status})` : ""}
      </div>
      <pre
        ref={logRef}
        className="min-h-0 flex-1 overflow-auto p-2 font-mono text-[length:var(--jet-fs-xs)] leading-relaxed text-[var(--jet-text)]"
      >
        {run?.output ?? "No task output. Run a task from the command palette."}
      </pre>
      {run && run.errors.length > 0 && (
        <div className="shrink-0 border-t border-[var(--jet-border)] p-1 text-[length:var(--jet-fs-xs)] text-[var(--jet-error)]">
          {run.errors.length} error(s) — use Location List → Tasks or jump commands
        </div>
      )}
    </div>
  )
}

function useStateRev(state: { onDidChange: { event: (fn: () => void) => { dispose: () => void } } }): void {
  const [, setRev] = useState(0)
  useEffect(() => {
    return state.onDidChange.event(() => setRev(r => r + 1)).dispose
  }, [state])
}
