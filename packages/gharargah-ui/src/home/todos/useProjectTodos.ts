import { useEffect, useMemo, useState } from "react"
import {
  PROJECT_TODOS_STORAGE_KEY,
  PROJECT_TODO_UI_STORAGE_KEY,
  getSharedRepository,
  type CreateProjectTodoInput,
  type ProjectTodo,
  type ProjectTodosRepository,
  type UpdateProjectTodoPatch,
  projectTodoKey,
} from "./project-todos-repository.js"

export type ProjectTodosApi = {
  list(projectId: string): ProjectTodo[]
  create(projectId: string, input: CreateProjectTodoInput): ProjectTodo | null
  update(todoId: string, patch: UpdateProjectTodoPatch): ProjectTodo | null
  toggle(todoId: string): ProjectTodo | null
  remove(todoId: string): boolean
  reorder(projectId: string, orderedIds: string[]): void
  isExpanded(projectId: string): boolean
  setExpanded(projectId: string, expanded: boolean): void
}

function makeApi(repo: ProjectTodosRepository): ProjectTodosApi {
  return {
    list: id => repo.listProjectTodos(id),
    create: (id, input) => repo.createProjectTodo(id, input),
    update: (todoId, patch) => repo.updateProjectTodo(todoId, patch),
    toggle: todoId => repo.toggleProjectTodo(todoId),
    remove: todoId => repo.deleteProjectTodo(todoId),
    reorder: (id, orderedIds) => {
      repo.reorderProjectTodos(id, orderedIds)
    },
    isExpanded: id => repo.isExpanded(id),
    setExpanded: (id, expanded) => repo.setExpanded(id, expanded),
  }
}

/**
 * Subscribe via useState tick (not useSyncExternalStore) so React Compiler /
 * dual-chunk notify cannot leave the home summary stuck on a stale revision.
 */
export function useProjectTodosLive(projectId: string): {
  todos: ProjectTodo[]
  expanded: boolean
  projectKey: string
  api: ProjectTodosApi
  revision: number
  total: number
  done: number
  /** Force a re-read from the shared repository (call after local mutations). */
  refresh: () => void
} {
  const projectKey = projectTodoKey(projectId)
  const [revision, setRevision] = useState(() => getSharedRepository().getRevision())
  const [epoch, setEpoch] = useState(0)

  useEffect(() => {
    const repo = getSharedRepository()
    const bump = () => {
      setRevision(repo.getRevision())
      setEpoch(e => e + 1)
    }
    const unsub = repo.subscribe(bump)
    const onEvent = () => bump()
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === PROJECT_TODOS_STORAGE_KEY ||
        e.key === PROJECT_TODO_UI_STORAGE_KEY ||
        e.key === null
      ) {
        getSharedRepository().hydrateFromStorage()
      }
    }
    window.addEventListener("gharargah:project-todos", onEvent)
    window.addEventListener("storage", onStorage)
    // Catch up if something mutated before this effect attached.
    bump()
    return () => {
      unsub()
      window.removeEventListener("gharargah:project-todos", onEvent)
      window.removeEventListener("storage", onStorage)
    }
  }, [])

  const refresh = () => {
    setRevision(getSharedRepository().getRevision())
    setEpoch(e => e + 1)
  }

  const repo = getSharedRepository()
  const todos = useMemo(
    () => repo.listProjectTodos(projectKey),
    // revision/epoch intentionally invalidate the list snapshot
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectKey, revision, epoch],
  )
  const expanded = useMemo(
    () => repo.isExpanded(projectKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectKey, revision, epoch],
  )
  const api = useMemo(() => makeApi(repo), [repo])
  const done = todos.filter(t => t.completed).length
  return {
    todos,
    expanded,
    projectKey,
    api,
    revision,
    total: todos.length,
    done,
    refresh,
  }
}
