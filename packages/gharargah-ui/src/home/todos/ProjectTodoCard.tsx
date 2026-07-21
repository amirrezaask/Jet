import { Card, CardContent, CardHeader } from "@/components/ui/card.js"
import { Button } from "@/components/ui/button.js"
import { cn } from "@/lib/utils.js"
import type { ProjectTodo } from "./project-todos-repository.js"
import { ProjectTodoComposer } from "./ProjectTodoComposer.js"
import { ProjectTodoEmptyState } from "./ProjectTodoEmptyState.js"
import { ProjectTodoList } from "./ProjectTodoList.js"
import { ProjectTodoProgress } from "./ProjectTodoProgress.js"

export type ProjectTodoCardProps = {
  todos: ProjectTodo[]
  composing: boolean
  onComposingChange: (open: boolean) => void
  onCreate: (input: { text: string }) => void
  onToggle: (id: string) => void
  onUpdate: (id: string, patch: { text?: string }) => void
  onDelete: (id: string) => void
  onReorder: (orderedIds: string[]) => void
  onViewAll: () => void
  className?: string
}

const PREVIEW_LIMIT = 4

export function ProjectTodoCard(props: ProjectTodoCardProps) {
  const {
    todos,
    composing,
    onComposingChange,
    onCreate,
    onToggle,
    onUpdate,
    onDelete,
    onReorder,
    onViewAll,
    className,
  } = props
  const done = todos.filter(t => t.completed).length
  const total = todos.length

  return (
    <Card
      data-gharargah-todo-card
      className={cn(
        "gharargah-home-session-card flex h-full min-h-[5.5rem] flex-col gap-1.5 border-border/80 bg-card/80 py-2.5",
        className,
      )}
    >
      <CardHeader className="gap-0 px-3 py-0 [.border-b]:pb-0">
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-3xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
            Todos
          </span>
          {total > 0 ? (
            <span className="font-mono text-3xs tabular-nums text-muted-foreground">
              {done}/{total} complete
            </span>
          ) : null}
        </div>
        {total > 0 ? (
          <ProjectTodoProgress
            total={total}
            done={done}
            variant="linear"
            className="mt-1.5"
          />
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-1.5 px-2 py-0">
        {total === 0 && !composing ? (
          <ProjectTodoEmptyState onAdd={() => onComposingChange(true)} />
        ) : (
          <>
            <ProjectTodoList
              todos={todos}
              limit={PREVIEW_LIMIT}
              onToggle={onToggle}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onReorder={onReorder}
            />
            <ProjectTodoComposer
              open={composing}
              onCancel={() => onComposingChange(false)}
              onSubmit={onCreate}
            />
            {!composing ? (
              <div className="mt-auto flex items-center justify-between gap-2 px-1 pt-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-3xs text-primary"
                  data-gharargah-todo-card-add
                  onClick={() => onComposingChange(true)}
                >
                  + Add todo
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-3xs text-muted-foreground"
                  data-gharargah-todo-view-all
                  onClick={onViewAll}
                >
                  View all
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}
