import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { ArrowRight, GripVertical, MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Button } from "@/components/ui/button.js"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js"
import { Input } from "@/components/ui/input.js"
import { cn } from "@/lib/utils.js"
import {
  PROJECT_TODO_STATUS_LABEL,
  PROJECT_TODO_STATUSES,
  type ProjectTodo,
  type ProjectTodoStatus,
} from "./project-todos-repository.js"

export type ProjectTodoCardProps = {
  todo: ProjectTodo
  onUpdate: (id: string, patch: { text?: string }) => void
  onDelete: (id: string) => void
  onMoveStatus: (id: string, status: ProjectTodoStatus) => void
  disableDrag?: boolean
}

export function ProjectTodoCard(props: ProjectTodoCardProps) {
  const { todo, onUpdate, onDelete, onMoveStatus, disableDrag } = props
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(todo.text)
  const inputRef = useRef<HTMLInputElement>(null)
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: todo.id, disabled: disableDrag || editing })

  useEffect(() => {
    if (!editing) setDraft(todo.text)
  }, [todo.text, editing])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const commitEdit = () => {
    const next = draft.trim()
    if (!next) {
      setDraft(todo.text)
      setEditing(false)
      return
    }
    if (next !== todo.text) onUpdate(todo.id, { text: next })
    setEditing(false)
  }

  const onEditKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      commitEdit()
    } else if (e.key === "Escape") {
      e.preventDefault()
      setDraft(todo.text)
      setEditing(false)
    }
  }

  const otherStatuses = PROJECT_TODO_STATUSES.filter(s => s !== todo.status)

  return (
    <div
      ref={setNodeRef}
      data-gharargah-todo-item
      data-gharargah-todo-card
      data-todo-id={todo.id}
      data-todo-status={todo.status}
      data-completed={todo.completed ? "true" : "false"}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "group flex flex-col gap-1.5 rounded-md border border-border/60 bg-card/80 p-2 shadow-sm",
        "hover:border-border hover:bg-card",
        isDragging && "z-10 border-primary/40 opacity-90 shadow-md ring-1 ring-primary/30",
        todo.status === "done" && "opacity-70",
      )}
    >
      <div className="flex items-start gap-1">
        {!disableDrag ? (
          <button
            type="button"
            className="mt-0.5 flex size-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/70 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 active:cursor-grabbing"
            aria-label={`Reorder ${todo.text}`}
            data-gharargah-todo-drag
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-3.5" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          {editing ? (
            <Input
              ref={inputRef}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={onEditKeyDown}
              aria-label="Edit todo"
              data-gharargah-todo-edit-input
              className="h-7 text-xs"
            />
          ) : (
            <button
              type="button"
              className={cn(
                "w-full whitespace-pre-wrap text-left text-xs leading-snug text-foreground outline-none",
                "focus-visible:rounded-sm focus-visible:ring-[3px] focus-visible:ring-ring/40",
                todo.status === "done" && "text-muted-foreground line-through",
              )}
              onDoubleClick={() => setEditing(true)}
              data-gharargah-todo-text
            >
              {todo.text}
            </button>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="size-6 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
              aria-label={`Actions for ${todo.text}`}
              data-gharargah-todo-item-menu
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" collisionPadding={8}>
            <DropdownMenuItem onSelect={() => setEditing(true)}>
              <Pencil className="size-4" />
              Edit
            </DropdownMenuItem>
            {otherStatuses.map(status => (
              <DropdownMenuItem
                key={status}
                onSelect={() => onMoveStatus(todo.id, status)}
              >
                <ArrowRight className="size-4" />
                Move to {PROJECT_TODO_STATUS_LABEL[status]}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(todo.id)}>
              <Trash2 className="size-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
