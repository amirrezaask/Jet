import type { WorkspaceService } from "@jet/workspace"
import { useEffect, useRef, useState } from "react"
import { ScrollArea } from "@/components/ui/scroll-area.js"

export function OutputPanel({ workspace }: { workspace: WorkspaceService }) {
  useStateRev(workspace.taskRunner)
  const run = workspace.taskRunner.activeRun()
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [run?.output])

  return (
    <div className="flex h-full min-h-0 flex-col" data-jet-list-panel="output">
      <div className="shrink-0 border-b border-border px-2 py-1 text-xs text-muted-foreground">
        Output {run ? `— ${run.task.label} (${run.status})` : ""}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <pre
          ref={logRef}
          className="p-2 font-mono text-xs leading-relaxed text-foreground"
        >
          {run?.output ?? "No task output. Run a task from the command palette."}
        </pre>
      </ScrollArea>
      {run && run.errors.length > 0 && (
        <div className="shrink-0 border-t border-border p-1 text-xs text-destructive">
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
