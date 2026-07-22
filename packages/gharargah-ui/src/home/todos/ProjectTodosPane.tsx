import { useCallback, useRef } from "react"
import { getSharedRepository } from "./project-todos-repository.js"
import type { ProjectTodoStatus } from "./project-todos-repository.js"
import { ProjectTodoBoard } from "./ProjectTodoBoard.js"
import { useProjectTodosLive } from "./useProjectTodos.js"

export type ProjectTodosPaneProps = {
  projectId: string
  projectName: string
}

/** Session-modal TODOs board for one project. */
export function ProjectTodosPane(props: ProjectTodosPaneProps) {
  const { projectId, projectName } = props
  const { todos, projectKey, refresh } = useProjectTodosLive(projectId)
  const liveRef = useRef<HTMLDivElement>(null)

  const announce = useCallback((message: string) => {
    const el = liveRef.current
    if (!el) return
    el.textContent = ""
    requestAnimationFrame(() => {
      el.textContent = message
    })
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col" data-gharargah-todo-pane>
      <div
        ref={liveRef}
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
        data-gharargah-todo-live
      />
      <ProjectTodoBoard
        projectId={projectKey}
        projectName={projectName}
        todos={todos}
        onCreate={input => {
          const created = getSharedRepository().createProjectTodo(projectKey, input)
          refresh()
          if (created) announce(`Card created: ${created.text}`)
        }}
        onUpdate={(id, patch) => {
          getSharedRepository().updateProjectTodo(id, patch)
          refresh()
        }}
        onDelete={id => {
          const text = getSharedRepository()
            .listProjectTodos(projectKey)
            .find(t => t.id === id)?.text
          const ok = getSharedRepository().deleteProjectTodo(id)
          refresh()
          if (ok && text) announce(`Card deleted: ${text}`)
        }}
        onMove={(id, toStatus, toIndex) => {
          getSharedRepository().moveProjectTodo(id, toStatus, toIndex)
          refresh()
        }}
        onReorderColumn={(status: ProjectTodoStatus, orderedIds) => {
          getSharedRepository().reorderColumn(projectKey, status, orderedIds)
          refresh()
        }}
      />
    </div>
  )
}
