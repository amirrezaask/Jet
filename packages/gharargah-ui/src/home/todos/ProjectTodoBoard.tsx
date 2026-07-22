import { useMemo, useState } from "react"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button.js"
import { cn } from "@/lib/utils.js"
import {
  PROJECT_TODO_STATUS_LABEL,
  PROJECT_TODO_STATUSES,
  type ProjectTodo,
  type ProjectTodoStatus,
} from "./project-todos-repository.js"
import { ProjectTodoCard } from "./ProjectTodoCard.js"
import { ProjectTodoComposer } from "./ProjectTodoComposer.js"

export type ProjectTodoBoardProps = {
  projectId: string
  projectName: string
  todos: ProjectTodo[]
  onCreate: (input: { text: string; status?: ProjectTodoStatus }) => void
  onUpdate: (id: string, patch: { text?: string }) => void
  onDelete: (id: string) => void
  onMove: (id: string, toStatus: ProjectTodoStatus, toIndex?: number) => void
  onReorderColumn: (status: ProjectTodoStatus, orderedIds: string[]) => void
  className?: string
}

export function ProjectTodoBoard(props: ProjectTodoBoardProps) {
  const {
    projectId,
    projectName,
    todos,
    onCreate,
    onUpdate,
    onDelete,
    onMove,
    onReorderColumn,
    className,
  } = props
  const [composingStatus, setComposingStatus] = useState<ProjectTodoStatus | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)

  const byStatus = useMemo(() => {
    const map: Record<ProjectTodoStatus, ProjectTodo[]> = {
      todo: [],
      doing: [],
      done: [],
    }
    for (const todo of todos) {
      map[todo.status].push(todo)
    }
    for (const status of PROJECT_TODO_STATUSES) {
      map[status] = [...map[status]].sort((a, b) => {
        if (a.position !== b.position) return a.position - b.position
        return a.createdAt.localeCompare(b.createdAt)
      })
    }
    return map
  }, [todos])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const activeTodo = activeId ? todos.find(t => t.id === activeId) : null
  const done = todos.filter(t => t.status === "done").length
  const total = todos.length

  const findContainer = (id: string): ProjectTodoStatus | null => {
    if (PROJECT_TODO_STATUSES.includes(id as ProjectTodoStatus)) {
      return id as ProjectTodoStatus
    }
    const hit = todos.find(t => t.id === id)
    return hit?.status ?? null
  }

  const onDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id))
  }

  const onDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    if (!over) return
    const activeContainer = findContainer(String(active.id))
    const overContainer = findContainer(String(over.id))
    if (!activeContainer || !overContainer || activeContainer === overContainer) return
    const overItems = byStatus[overContainer]
    const overIndex = overItems.findIndex(t => t.id === String(over.id))
    const insertAt =
      overIndex >= 0
        ? overIndex
        : overItems.length
    onMove(String(active.id), overContainer, insertAt)
  }

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveId(null)
    if (!over) return
    const activeContainer = findContainer(String(active.id))
    const overContainer = findContainer(String(over.id))
    if (!activeContainer || !overContainer) return

    if (activeContainer === overContainer) {
      const ids = byStatus[activeContainer].map(t => t.id)
      const oldIndex = ids.indexOf(String(active.id))
      const newIndex = PROJECT_TODO_STATUSES.includes(String(over.id) as ProjectTodoStatus)
        ? ids.length - 1
        : ids.indexOf(String(over.id))
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
      onReorderColumn(activeContainer, arrayMove(ids, oldIndex, newIndex))
      return
    }

    const overItems = byStatus[overContainer].map(t => t.id).filter(id => id !== String(active.id))
    const overIndex = overItems.indexOf(String(over.id))
    const insertAt = overIndex >= 0 ? overIndex : overItems.length
    onMove(String(active.id), overContainer, insertAt)
  }

  return (
    <div
      data-gharargah-todo-board
      data-project-id={projectId}
      data-todo-count={total}
      className={cn("flex h-full min-h-0 flex-col gap-3 p-3", className)}
    >
      <div className="flex shrink-0 items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            TODOs
          </h2>
          <p className="mt-0.5 truncate text-3xs text-muted-foreground">
            {projectName}
            {total > 0 ? ` · ${done}/${total} done` : ""}
          </p>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <div
          data-gharargah-todo-board-columns
          className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden md:grid-cols-3"
        >
          {PROJECT_TODO_STATUSES.map(status => (
            <TodoColumn
              key={status}
              status={status}
              todos={byStatus[status]}
              composing={composingStatus === status}
              onCompose={() => setComposingStatus(status)}
              onCancelCompose={() => setComposingStatus(null)}
              onCreate={input => {
                onCreate({ ...input, status })
                setComposingStatus(null)
              }}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onMoveStatus={(id, next) => onMove(id, next)}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeTodo ? (
            <div className="rounded-md border border-primary/40 bg-card p-2 text-xs shadow-lg opacity-90">
              {activeTodo.text}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

function TodoColumn(props: {
  status: ProjectTodoStatus
  todos: ProjectTodo[]
  composing: boolean
  onCompose: () => void
  onCancelCompose: () => void
  onCreate: (input: { text: string }) => void
  onUpdate: (id: string, patch: { text?: string }) => void
  onDelete: (id: string) => void
  onMoveStatus: (id: string, status: ProjectTodoStatus) => void
}) {
  const {
    status,
    todos,
    composing,
    onCompose,
    onCancelCompose,
    onCreate,
    onUpdate,
    onDelete,
    onMoveStatus,
  } = props
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const ids = todos.map(t => t.id)

  return (
    <section
      ref={setNodeRef}
      data-gharargah-todo-column={status}
      data-todo-column-count={todos.length}
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border/50 bg-muted/15",
        isOver && "border-primary/40 bg-primary/5",
      )}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/40 px-2.5 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="text-2xs font-semibold tracking-wide text-foreground">
            {PROJECT_TODO_STATUS_LABEL[status]}
          </h3>
          <span
            data-gharargah-todo-column-count
            className="rounded-sm bg-muted/60 px-1.5 py-0.5 font-mono text-3xs tabular-nums text-muted-foreground"
          >
            {todos.length}
          </span>
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="size-6 text-muted-foreground"
          aria-label={`Add card to ${PROJECT_TODO_STATUS_LABEL[status]}`}
          data-gharargah-todo-column-add={status}
          onClick={onCompose}
        >
          <Plus className="size-3.5" />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {todos.map(todo => (
            <ProjectTodoCard
              key={todo.id}
              todo={todo}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onMoveStatus={onMoveStatus}
            />
          ))}
        </SortableContext>

        {todos.length === 0 && !composing ? (
          <p
            data-gharargah-todo-column-empty
            className="px-1 py-3 text-center text-3xs text-muted-foreground"
          >
            Drop cards here
          </p>
        ) : null}

        {composing ? (
          <ProjectTodoComposer
            open
            submitLabel="Add card"
            onCancel={onCancelCompose}
            onSubmit={onCreate}
          />
        ) : null}
      </div>
    </section>
  )
}
