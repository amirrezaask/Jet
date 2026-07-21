import { Button } from "@/components/ui/button.js"

export type ProjectTodoEmptyStateProps = {
  onAdd: () => void
}

export function ProjectTodoEmptyState(props: ProjectTodoEmptyStateProps) {
  const { onAdd } = props
  return (
    <div
      data-gharargah-todo-empty
      className="flex flex-col gap-2 px-1 py-2"
    >
      <p className="text-xs font-medium text-foreground">No todos yet</p>
      <p className="text-3xs leading-snug text-muted-foreground">
        Keep track of work that is not assigned to an agent.
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="mt-1 h-7 w-fit px-2 text-3xs"
        data-gharargah-todo-empty-add
        onClick={onAdd}
      >
        + Add first todo
      </Button>
    </div>
  )
}
