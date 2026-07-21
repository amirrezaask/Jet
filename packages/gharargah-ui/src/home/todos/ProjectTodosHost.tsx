import { useCallback, useRef, useState, type ReactNode } from "react"
import { getSharedRepository } from "./project-todos-repository.js"
import { ProjectTodoCard } from "./ProjectTodoCard.js"
import { ProjectTodoDrawer } from "./ProjectTodoDrawer.js"
import { ProjectTodoSummary } from "./ProjectTodoSummary.js"
import { useProjectTodosLive } from "./useProjectTodos.js"

export type ProjectTodosBundleProps = {
  projectId: string
  projectName: string
}

export type ProjectTodosBundle = {
  summary: ReactNode
  card: ReactNode
}

/**
 * Builds summary (header) + optional card (grid) + shared bottom drawer for one project.
 */
export function useProjectTodosBundle(props: ProjectTodosBundleProps): ProjectTodosBundle {
  const { projectId, projectName } = props
  const { todos, expanded, total, done, projectKey, refresh } = useProjectTodosLive(projectId)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerComposing, setDrawerComposing] = useState(false)
  const [cardComposing, setCardComposing] = useState(false)
  const liveRef = useRef<HTMLDivElement>(null)

  const announce = useCallback((message: string) => {
    const el = liveRef.current
    if (!el) return
    el.textContent = ""
    requestAnimationFrame(() => {
      el.textContent = message
    })
  }, [])

  const setExpanded = useCallback((value: boolean) => {
    getSharedRepository().setExpanded(projectKey, value)
    refresh()
    if (!value) setCardComposing(false)
  }, [projectKey, refresh])

  const onCreate = useCallback(
    (input: { text: string }) => {
      const created = getSharedRepository().createProjectTodo(projectKey, input)
      refresh()
      if (created) announce(`Todo created: ${created.text}`)
      return created
    },
    [projectKey, announce, refresh],
  )

  const onToggle = useCallback(
    (id: string) => {
      const next = getSharedRepository().toggleProjectTodo(id)
      refresh()
      if (!next) return
      announce(
        next.completed
          ? `Todo completed: ${next.text}`
          : `Todo marked open: ${next.text}`,
      )
    },
    [announce, refresh],
  )

  const onUpdate = useCallback(
    (id: string, patch: { text?: string }) => {
      getSharedRepository().updateProjectTodo(id, patch)
      refresh()
    },
    [refresh],
  )

  const onDelete = useCallback(
    (id: string) => {
      const text = getSharedRepository().listProjectTodos(projectKey).find(t => t.id === id)?.text
      const ok = getSharedRepository().deleteProjectTodo(id)
      refresh()
      if (ok && text) announce(`Todo deleted: ${text}`)
    },
    [projectKey, announce, refresh],
  )

  const onReorder = useCallback(
    (orderedIds: string[]) => {
      getSharedRepository().reorderProjectTodos(projectKey, orderedIds)
      refresh()
    },
    [projectKey, refresh],
  )

  const openDrawer = useCallback((opts?: { compose?: boolean }) => {
    if (!expanded) setExpanded(true)
    setDrawerOpen(true)
    if (opts?.compose) setDrawerComposing(true)
  }, [expanded, setExpanded])

  const toggleDrawer = useCallback(() => {
    if (drawerOpen) {
      setDrawerOpen(false)
      setDrawerComposing(false)
      return
    }
    openDrawer({ compose: total === 0 })
  }, [drawerOpen, openDrawer, total])

  const summary = (
    <>
      <div
        ref={liveRef}
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
        data-gharargah-todo-live
      />
      <ProjectTodoSummary
        projectName={projectName}
        projectId={projectKey}
        total={total}
        done={done}
        open={drawerOpen}
        onOpenDrawer={toggleDrawer}
      />
      <ProjectTodoDrawer
        open={drawerOpen}
        onOpenChange={open => {
          setDrawerOpen(open)
          if (!open) {
            setDrawerComposing(false)
          } else if (!expanded) {
            setExpanded(true)
          }
        }}
        projectName={projectName}
        projectId={projectKey}
        todos={todos}
        composing={drawerComposing}
        onComposingChange={setDrawerComposing}
        onCreate={input => {
          const created = onCreate(input)
          if (created) setDrawerComposing(false)
        }}
        onToggle={onToggle}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onReorder={onReorder}
      />
    </>
  )

  const card = expanded ? (
    <div data-gharargah-todo-card-wrap className="min-w-0">
      <ProjectTodoCard
        todos={todos}
        composing={cardComposing}
        onComposingChange={setCardComposing}
        onCreate={input => {
          const created = onCreate(input)
          if (created) setCardComposing(false)
        }}
        onToggle={onToggle}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onReorder={onReorder}
        onViewAll={() => openDrawer()}
      />
    </div>
  ) : null

  return { summary, card }
}
