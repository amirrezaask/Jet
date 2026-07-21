import { useMemo, useState } from "react"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { cn } from "@/lib/utils.js"
import type { ProjectTodo } from "./project-todos-repository.js"
import { ProjectTodoItem } from "./ProjectTodoItem.js"

export type ProjectTodoFilter = "all" | "open" | "done"

export type ProjectTodoListProps = {
  todos: ProjectTodo[]
  filter?: ProjectTodoFilter
  limit?: number
  onToggle: (id: string) => void
  onUpdate: (id: string, patch: { text?: string }) => void
  onDelete: (id: string) => void
  onReorder: (orderedIds: string[]) => void
  className?: string
  disableDrag?: boolean
}

export function ProjectTodoList(props: ProjectTodoListProps) {
  const {
    todos,
    filter = "all",
    limit,
    onToggle,
    onUpdate,
    onDelete,
    onReorder,
    className,
    disableDrag,
  } = props

  const filtered = useMemo(() => {
    if (filter === "open") return todos.filter(t => !t.completed)
    if (filter === "done") return todos.filter(t => t.completed)
    return todos
  }, [todos, filter])

  const visible = limit != null ? filtered.slice(0, limit) : filtered
  const hiddenCount = limit != null ? Math.max(0, filtered.length - visible.length) : 0
  const ids = visible.map(t => t.id)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const move = (id: string, dir: -1 | 1) => {
    const index = todos.findIndex(t => t.id === id)
    if (index < 0) return
    const next = index + dir
    if (next < 0 || next >= todos.length) return
    onReorder(arrayMove(todos.map(t => t.id), index, next))
  }

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = ids.indexOf(String(active.id))
    const newIndex = ids.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    // When filtered/limited, map back onto full ordered id list.
    const fullIds = todos.map(t => t.id)
    const fromId = ids[oldIndex]!
    const toId = ids[newIndex]!
    const from = fullIds.indexOf(fromId)
    const to = fullIds.indexOf(toId)
    if (from < 0 || to < 0) return
    onReorder(arrayMove(fullIds, from, to))
  }

  if (visible.length === 0) {
    return (
      <p
        data-gharargah-todo-list-empty
        className="px-1 py-2 text-3xs text-muted-foreground"
      >
        {filter === "done" ? "No completed todos." : filter === "open" ? "No open todos." : "No todos."}
      </p>
    )
  }

  return (
    <div data-gharargah-todo-list className={cn("flex flex-col gap-0.5", className)}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {visible.map((todo, index) => (
            <ProjectTodoItem
              key={todo.id}
              todo={todo}
              onToggle={onToggle}
              onUpdate={onUpdate}
              onDelete={onDelete}
              disableDrag={disableDrag}
              onMoveUp={index > 0 || todos.findIndex(t => t.id === todo.id) > 0
                ? id => move(id, -1)
                : undefined}
              onMoveDown={
                todos.findIndex(t => t.id === todo.id) < todos.length - 1
                  ? id => move(id, 1)
                  : undefined
              }
            />
          ))}
        </SortableContext>
      </DndContext>
      {hiddenCount > 0 ? (
        <p className="px-1 pt-1 font-mono text-3xs text-muted-foreground">
          +{hiddenCount} more
        </p>
      ) : null}
    </div>
  )
}

export function useTodoFilter(initial: ProjectTodoFilter = "all") {
  return useState<ProjectTodoFilter>(initial)
}
