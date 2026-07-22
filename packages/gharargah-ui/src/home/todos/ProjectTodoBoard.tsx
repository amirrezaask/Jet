import { useEffect, useMemo, useState } from "react"
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

function groupByStatus(todos: ProjectTodo[]): Record<ProjectTodoStatus, ProjectTodo[]> {
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
  /** Local column snapshot while dragging — avoids persist-on-dragOver jank. */
  const [draft, setDraft] = useState<Record<ProjectTodoStatus, ProjectTodo[]> | null>(null)

  const byStatus = useMemo(() => groupByStatus(todos), [todos])
  const columns = draft ?? byStatus

  useEffect(() => {
    if (!activeId) setDraft(null)
  }, [todos, activeId])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const activeTodo = activeId
    ? todos.find(t => t.id === activeId) ??
      PROJECT_TODO_STATUSES.flatMap(s => columns[s]).find(t => t.id === activeId) ??
      null
    : null
  const done = todos.filter(t => t.status === "done").length
  const total = todos.length

  const findContainer = (
    id: string,
    source: Record<ProjectTodoStatus, ProjectTodo[]>,
  ): ProjectTodoStatus | null => {
    if (PROJECT_TODO_STATUSES.includes(id as ProjectTodoStatus)) {
      return id as ProjectTodoStatus
    }
    for (const status of PROJECT_TODO_STATUSES) {
      if (source[status].some(t => t.id === id)) return status
    }
    return null
  }

  const onDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id))
    setDraft(groupByStatus(todos))
  }

  const onDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    if (!over || !draft) return
    const activeContainer = findContainer(String(active.id), draft)
    const overContainer = findContainer(String(over.id), draft)
    if (!activeContainer || !overContainer || activeContainer === overContainer) return

    setDraft(prev => {
      if (!prev) return prev
      const activeItems = [...prev[activeContainer]]
      const overItems = [...prev[overContainer]]
      const activeIndex = activeItems.findIndex(t => t.id === String(active.id))
      if (activeIndex < 0) return prev
      const [moved] = activeItems.splice(activeIndex, 1)
      if (!moved) return prev
      const overIndex = overItems.findIndex(t => t.id === String(over.id))
      const insertAt =
        PROJECT_TODO_STATUSES.includes(String(over.id) as ProjectTodoStatus) || overIndex < 0
          ? overItems.length
          : overIndex
      const nextMoved: ProjectTodo = { ...moved, status: overContainer }
      overItems.splice(insertAt, 0, nextMoved)
      return {
        ...prev,
        [activeContainer]: activeItems,
        [overContainer]: overItems,
      }
    })
  }

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    const snapshot = draft
    setActiveId(null)
    setDraft(null)
    if (!over || !snapshot) return

    const activeIdStr = String(active.id)
    const original = todos.find(t => t.id === activeIdStr)
    if (!original) return

    const finalContainer = findContainer(activeIdStr, snapshot)
    const overContainer = findContainer(String(over.id), snapshot)
    if (!finalContainer || !overContainer) return

    // Cross-column: draft already holds the card in the target column.
    if (original.status !== finalContainer) {
      const toIndex = snapshot[finalContainer].findIndex(t => t.id === activeIdStr)
      onMove(activeIdStr, finalContainer, toIndex >= 0 ? toIndex : undefined)
      return
    }

    // Same-column reorder — draft order unchanged during drag; use over target.
    const ids = snapshot[finalContainer].map(t => t.id)
    const oldIndex = ids.indexOf(activeIdStr)
    const newIndex = PROJECT_TODO_STATUSES.includes(String(over.id) as ProjectTodoStatus)
      ? ids.length - 1
      : ids.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
    onReorderColumn(finalContainer, arrayMove(ids, oldIndex, newIndex))
  }

  const onDragCancel = () => {
    setActiveId(null)
    setDraft(null)
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
        onDragCancel={onDragCancel}
      >
        <div
          data-gharargah-todo-board-columns
          className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden md:grid-cols-3"
        >
          {PROJECT_TODO_STATUSES.map(status => (
            <TodoColumn
              key={status}
              status={status}
              todos={columns[status]}
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
            <div
              data-gharargah-todo-drag-overlay
              className="rounded-md border border-primary/40 bg-card p-2 text-xs shadow-lg opacity-90"
            >
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
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-muted",
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
