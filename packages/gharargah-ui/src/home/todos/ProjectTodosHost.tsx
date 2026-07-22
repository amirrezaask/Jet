import type { ReactNode } from "react"
import { ProjectTodoSummary } from "./ProjectTodoSummary.js"
import { useProjectTodosLive } from "./useProjectTodos.js"

export type ProjectTodosBundleProps = {
  projectId: string
  projectName: string
  /** Opens session modal on TODOs tab for this project. */
  onOpenTodos?: () => void
}

export type ProjectTodosBundle = {
  summary: ReactNode
}

/**
 * Home header summary — opens in-dialog TODOs board (no drawer).
 */
export function useProjectTodosBundle(props: ProjectTodosBundleProps): ProjectTodosBundle {
  const { projectId, projectName, onOpenTodos } = props
  const { total, done, projectKey } = useProjectTodosLive(projectId)

  const summary = (
    <ProjectTodoSummary
      projectName={projectName}
      projectId={projectKey}
      total={total}
      done={done}
      onOpenTodos={onOpenTodos}
    />
  )

  return { summary }
}
