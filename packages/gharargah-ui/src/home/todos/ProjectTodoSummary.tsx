import { cn } from "@/lib/utils.js"
import { ProjectTodoProgress } from "./ProjectTodoProgress.js"

export type ProjectTodoSummaryProps = {
  projectName: string
  projectId: string
  total: number
  done: number
  open: boolean
  onOpenDrawer: () => void
  className?: string
}

export function ProjectTodoSummary(props: ProjectTodoSummaryProps) {
  const { projectName, projectId, total, done, open, onOpenDrawer, className } = props
  const label =
    total === 0
      ? "0 todos"
      : total === done
        ? `${total} todos · all done`
        : `${total} todos · ${done}/${total} done`

  return (
    <div
      data-gharargah-todo-summary
      data-todo-count={total}
      data-todo-done={done}
      className={cn("flex shrink-0 items-center gap-1.5", className)}
    >
      <button
        type="button"
        data-gharargah-todo-summary-toggle
        className={cn(
          "flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-3xs text-muted-foreground",
          "outline-none transition-colors hover:bg-muted/40 hover:text-foreground",
          "focus-visible:ring-[3px] focus-visible:ring-ring/40",
          open && "bg-muted/40 text-foreground",
        )}
        aria-expanded={open}
        aria-controls={`gharargah-todo-drawer-${projectId}`}
        aria-label={`Todos for ${projectName}: ${label}. Open todo drawer.`}
        onClick={onOpenDrawer}
      >
        <span
          className="font-mono tabular-nums tracking-wide"
          data-gharargah-todo-summary-label
        >
          {label}
        </span>
        {total > 0 ? <ProjectTodoProgress total={total} done={done} /> : null}
      </button>
    </div>
  )
}
