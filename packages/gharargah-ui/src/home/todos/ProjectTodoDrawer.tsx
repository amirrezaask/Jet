import { useEffect, useId, useState } from "react"
import { X } from "lucide-react"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer.js"
import { Button } from "@/components/ui/button.js"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.js"
import { cn } from "@/lib/utils.js"
import type { ProjectTodo } from "./project-todos-repository.js"
import { ProjectTodoComposer } from "./ProjectTodoComposer.js"
import { ProjectTodoEmptyState } from "./ProjectTodoEmptyState.js"
import {
  ProjectTodoList,
  type ProjectTodoFilter,
} from "./ProjectTodoList.js"
import { ProjectTodoProgress } from "./ProjectTodoProgress.js"

export type ProjectTodoDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectName: string
  projectId: string
  todos: ProjectTodo[]
  composing: boolean
  onComposingChange: (open: boolean) => void
  onCreate: (input: { text: string }) => void
  onToggle: (id: string) => void
  onUpdate: (id: string, patch: { text?: string }) => void
  onDelete: (id: string) => void
  onReorder: (orderedIds: string[]) => void
}

export function ProjectTodoDrawer(props: ProjectTodoDrawerProps) {
  const {
    open,
    onOpenChange,
    projectName,
    projectId,
    todos,
    composing,
    onComposingChange,
    onCreate,
    onToggle,
    onUpdate,
    onDelete,
    onReorder,
  } = props
  const [filter, setFilter] = useState<ProjectTodoFilter>("all")
  const titleId = useId()
  const done = todos.filter(t => t.completed).length
  const total = todos.length

  useEffect(() => {
    if (!open) setFilter("all")
  }, [open])

  return (
    <Drawer
      open={open}
      onOpenChange={next => {
        // Esc / overlay / drag dismiss ignored — only the X button closes.
        if (next) onOpenChange(true)
      }}
      direction="bottom"
      shouldScaleBackground={false}
      repositionInputs={false}
    >
      <DrawerContent
        id={`gharargah-todo-drawer-${projectId}`}
        data-gharargah-todo-drawer
        data-project-id={projectId}
        data-todo-count={total}
        className={cn(
          "flex h-[min(72vh,32rem)] w-full max-w-none flex-col rounded-none border-border/80 bg-background/95",
          "backdrop-blur-md",
        )}
        aria-labelledby={titleId}
        onEscapeKeyDown={event => event.preventDefault()}
        onPointerDownOutside={event => event.preventDefault()}
        onInteractOutside={event => event.preventDefault()}
      >
        <DrawerHeader className="gap-2 border-b border-border/50 text-left md:gap-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DrawerTitle
                id={titleId}
                className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase"
              >
                Todos
              </DrawerTitle>
              <DrawerDescription className="mt-0.5 truncate text-3xs text-muted-foreground">
                {projectName}
                {total > 0 ? ` · ${done}/${total} complete` : ""}
              </DrawerDescription>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-3xs"
                data-gharargah-todo-drawer-add
                onClick={() => onComposingChange(true)}
              >
                + Add todo
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Close todos"
                data-gharargah-todo-drawer-close
                onClick={() => onOpenChange(false)}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          </div>
          {total > 0 ? (
            <ProjectTodoProgress total={total} done={done} variant="linear" />
          ) : null}
          <Tabs
            value={filter}
            onValueChange={v => setFilter(v as ProjectTodoFilter)}
            className="gap-0"
          >
            <TabsList variant="line" className="h-8 w-full justify-start gap-0 rounded-none bg-transparent p-0">
              <TabsTrigger value="all" className="h-8 flex-none px-3 text-3xs" data-gharargah-todo-filter="all">
                All
              </TabsTrigger>
              <TabsTrigger value="open" className="h-8 flex-none px-3 text-3xs" data-gharargah-todo-filter="open">
                Open
              </TabsTrigger>
              <TabsTrigger value="done" className="h-8 flex-none px-3 text-3xs" data-gharargah-todo-filter="done">
                Done
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </DrawerHeader>

        <div
          data-gharargah-todo-drawer-body
          className="min-h-0 flex-1 overflow-y-auto px-3 py-2"
        >
          {total === 0 && !composing ? (
            <ProjectTodoEmptyState onAdd={() => onComposingChange(true)} />
          ) : (
            <ProjectTodoList
              todos={todos}
              filter={filter}
              onToggle={onToggle}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onReorder={onReorder}
            />
          )}
        </div>

        <div className="border-t border-border/50 px-3 py-2.5">
          <ProjectTodoComposer
            open={composing}
            onCancel={() => onComposingChange(false)}
            onSubmit={input => {
              onCreate(input)
            }}
          />
          {!composing && total > 0 ? (
            <p className="px-1 text-3xs text-muted-foreground">
              Drag to reorder
            </p>
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
