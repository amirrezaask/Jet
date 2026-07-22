import { normalizeAbsPath } from "@gharargah/workspace"

export const PROJECT_TODOS_STORAGE_KEY = "jet-project-todos-v1"
export const PROJECT_TODO_UI_STORAGE_KEY = "jet-project-todo-ui-v1"

/** Kanban columns — Todo / Doing / Done. */
export type ProjectTodoStatus = "todo" | "doing" | "done"

export const PROJECT_TODO_STATUSES: readonly ProjectTodoStatus[] = [
  "todo",
  "doing",
  "done",
] as const

export const PROJECT_TODO_STATUS_LABEL: Record<ProjectTodoStatus, string> = {
  todo: "Todo",
  doing: "Doing",
  done: "Done",
}

export type ProjectTodo = {
  id: string
  projectId: string
  /** Single todo body (no separate title/description). */
  text: string
  status: ProjectTodoStatus
  /** @deprecated Prefer `status === "done"`. Kept for callers during migration. */
  completed: boolean
  position: number
  createdAt: string
  updatedAt: string
  completedAt?: string
}

export type CreateProjectTodoInput = {
  text: string
  status?: ProjectTodoStatus
}

export type UpdateProjectTodoPatch = {
  text?: string
  status?: ProjectTodoStatus
  /** Maps to status todo/done when `status` omitted. */
  completed?: boolean
}

type PersistedTodosDoc = {
  version: 1
  todos: ProjectTodo[]
}

type PersistedTodoUiDoc = {
  version: 1
  expanded: Record<string, boolean>
}

const EMPTY_TODOS: PersistedTodosDoc = { version: 1, todos: [] }
const EMPTY_UI: PersistedTodoUiDoc = { version: 1, expanded: {} }

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const map = new Map<string, string>()
  return {
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null
    },
    setItem(key: string, value: string) {
      map.set(key, value)
    },
  }
}

function defaultStorage(): Pick<Storage, "getItem" | "setItem"> {
  return typeof localStorage !== "undefined" ? localStorage : memoryStorage()
}

function newTodoId(): string {
  return crypto.randomUUID()
}

function nowIso(): string {
  return new Date().toISOString()
}

/** Stable project key: normalized absolute path (folder UUID regenerates on restore). */
export function projectTodoKey(pathOrId: string): string {
  const trimmed = pathOrId.trim()
  if (!trimmed) return trimmed
  try {
    return normalizeAbsPath(trimmed)
  } catch {
    return trimmed
  }
}

function coerceStatus(
  item: Record<string, unknown>,
): ProjectTodoStatus {
  if (item.status === "todo" || item.status === "doing" || item.status === "done") {
    return item.status
  }
  if (typeof item.completed === "boolean") {
    return item.completed ? "done" : "todo"
  }
  return "todo"
}

function withDerived(todo: Omit<ProjectTodo, "completed">): ProjectTodo {
  return {
    ...todo,
    completed: todo.status === "done",
  }
}

function sortTodos(todos: ProjectTodo[]): ProjectTodo[] {
  return [...todos].sort((a, b) => {
    const statusOrder =
      PROJECT_TODO_STATUSES.indexOf(a.status) - PROJECT_TODO_STATUSES.indexOf(b.status)
    if (statusOrder !== 0) return statusOrder
    if (a.position !== b.position) return a.position - b.position
    return a.createdAt.localeCompare(b.createdAt)
  })
}

/** Accept current `text` or legacy `title` (+ optional description appended). */
function coerceTodoText(item: Record<string, unknown>): string | null {
  if (typeof item.text === "string") {
    const text = item.text.trim()
    return text || null
  }
  if (typeof item.title === "string") {
    const title = item.title.trim()
    if (!title) return null
    const description =
      typeof item.description === "string" ? item.description.trim() : ""
    return description ? `${title}\n${description}` : title
  }
  return null
}

function readTodosDoc(
  storage: Pick<Storage, "getItem"> = localStorage,
): PersistedTodosDoc {
  try {
    const raw = storage.getItem(PROJECT_TODOS_STORAGE_KEY)
    if (!raw) return EMPTY_TODOS
    const parsed = JSON.parse(raw) as Partial<PersistedTodosDoc>
    if (parsed.version !== 1 || !Array.isArray(parsed.todos)) return EMPTY_TODOS
    const todos: ProjectTodo[] = []
    for (const rawItem of parsed.todos) {
      if (!rawItem || typeof rawItem !== "object") continue
      const item = rawItem as Record<string, unknown>
      if (typeof item.id !== "string" || typeof item.projectId !== "string") continue
      const text = coerceTodoText(item)
      if (!text) continue
      if (typeof item.position !== "number") continue
      if (typeof item.createdAt !== "string" || typeof item.updatedAt !== "string") continue
      const status = coerceStatus(item)
      todos.push(
        withDerived({
          id: item.id,
          projectId: projectTodoKey(item.projectId),
          text,
          status,
          position: item.position,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          completedAt:
            typeof item.completedAt === "string"
              ? item.completedAt
              : status === "done"
                ? item.updatedAt
                : undefined,
        }),
      )
    }
    return { version: 1, todos }
  } catch {
    return EMPTY_TODOS
  }
}

function writeTodosDoc(
  doc: PersistedTodosDoc,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  try {
    storage.setItem(PROJECT_TODOS_STORAGE_KEY, JSON.stringify(doc))
  } catch {
    /* localStorage may be disabled */
  }
}

function readUiDoc(
  storage: Pick<Storage, "getItem"> = localStorage,
): PersistedTodoUiDoc {
  try {
    const raw = storage.getItem(PROJECT_TODO_UI_STORAGE_KEY)
    if (!raw) return EMPTY_UI
    const parsed = JSON.parse(raw) as Partial<PersistedTodoUiDoc>
    if (parsed.version !== 1 || typeof parsed.expanded !== "object" || !parsed.expanded) {
      return EMPTY_UI
    }
    const expanded: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(parsed.expanded)) {
      if (typeof value === "boolean") expanded[projectTodoKey(key)] = value
    }
    return { version: 1, expanded }
  } catch {
    return EMPTY_UI
  }
}

function writeUiDoc(
  doc: PersistedTodoUiDoc,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  try {
    storage.setItem(PROJECT_TODO_UI_STORAGE_KEY, JSON.stringify(doc))
  } catch {
    /* localStorage may be disabled */
  }
}

export type ProjectTodosRepository = {
  listProjectTodos(projectId: string): ProjectTodo[]
  listByStatus(projectId: string, status: ProjectTodoStatus): ProjectTodo[]
  createProjectTodo(projectId: string, input: CreateProjectTodoInput): ProjectTodo | null
  updateProjectTodo(todoId: string, patch: UpdateProjectTodoPatch): ProjectTodo | null
  setProjectTodoStatus(todoId: string, status: ProjectTodoStatus): ProjectTodo | null
  /** Move card into a column at index (default: append). Reindexes that column. */
  moveProjectTodo(
    todoId: string,
    toStatus: ProjectTodoStatus,
    toIndex?: number,
  ): ProjectTodo | null
  toggleProjectTodo(todoId: string): ProjectTodo | null
  deleteProjectTodo(todoId: string): boolean
  /** Reorder within one column (orderedIds = that column only). */
  reorderColumn(
    projectId: string,
    status: ProjectTodoStatus,
    orderedIds: string[],
  ): ProjectTodo[]
  /** @deprecated Prefer reorderColumn / moveProjectTodo. Full-project id order. */
  reorderProjectTodos(projectId: string, orderedIds: string[]): ProjectTodo[]
  isExpanded(projectId: string): boolean
  setExpanded(projectId: string, expanded: boolean): void
  /** Re-read localStorage into memory (drawer open / cross-chunk safety). */
  hydrateFromStorage(): void
  /** Monotonic revision for useSyncExternalStore snapshots. */
  getRevision(): number
  subscribe(listener: () => void): () => void
  /** Test helper — replace backing storage + reset memory. */
  _resetForTests(storage?: Storage): void
}

export function createProjectTodosRepository(
  initialStorage: Pick<Storage, "getItem" | "setItem"> = defaultStorage(),
): ProjectTodosRepository {
  let storage = initialStorage
  let todos = sortTodos(readTodosDoc(storage).todos)
  let expanded = { ...readUiDoc(storage).expanded }
  let revision = 0
  const listeners = new Set<() => void>()

  const persistTodos = () => {
    writeTodosDoc({ version: 1, todos }, storage)
  }

  const persistUi = () => {
    writeUiDoc({ version: 1, expanded }, storage)
  }

  const notify = () => {
    revision += 1
    for (const listener of listeners) listener()
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("gharargah:project-todos"))
    }
  }

  const findIndex = (todoId: string) => todos.findIndex(t => t.id === todoId)

  const reindexColumn = (projectId: string, status: ProjectTodoStatus) => {
    const key = projectTodoKey(projectId)
    let pos = 0
    todos = todos.map(t => {
      if (t.projectId !== key || t.status !== status) return t
      const next = withDerived({ ...t, position: pos, updatedAt: nowIso() })
      pos += 1
      return next
    })
  }

  return {
    listProjectTodos(projectId: string): ProjectTodo[] {
      const key = projectTodoKey(projectId)
      return sortTodos(todos.filter(t => t.projectId === key))
    },

    listByStatus(projectId: string, status: ProjectTodoStatus): ProjectTodo[] {
      const key = projectTodoKey(projectId)
      return sortTodos(
        todos.filter(t => t.projectId === key && t.status === status),
      )
    },

    createProjectTodo(projectId: string, input: CreateProjectTodoInput): ProjectTodo | null {
      const text = input.text.trim()
      if (!text) return null
      const key = projectTodoKey(projectId)
      if (!key) return null
      const status = input.status ?? "todo"
      const siblings = todos.filter(t => t.projectId === key && t.status === status)
      const maxPos = siblings.reduce((max, t) => Math.max(max, t.position), -1)
      const stamp = nowIso()
      const todo = withDerived({
        id: newTodoId(),
        projectId: key,
        text,
        status,
        position: maxPos + 1,
        createdAt: stamp,
        updatedAt: stamp,
        completedAt: status === "done" ? stamp : undefined,
      })
      todos = [...todos, todo]
      persistTodos()
      notify()
      return todo
    },

    updateProjectTodo(todoId: string, patch: UpdateProjectTodoPatch): ProjectTodo | null {
      const idx = findIndex(todoId)
      if (idx < 0) return null
      const current = todos[idx]!
      let text = current.text
      if (patch.text !== undefined) {
        const next = patch.text.trim()
        if (!next) return null
        text = next
      }
      let status = current.status
      if (patch.status !== undefined) {
        status = patch.status
      } else if (patch.completed !== undefined) {
        if (patch.completed) status = "done"
        else if (current.status === "done") status = "todo"
      }
      let completedAt = current.completedAt
      if (status === "done" && current.status !== "done") {
        completedAt = nowIso()
      } else if (status !== "done") {
        completedAt = undefined
      }
      const next = withDerived({
        ...current,
        text,
        status,
        completedAt,
        updatedAt: nowIso(),
      })
      todos = todos.map((t, i) => (i === idx ? next : t))
      if (status !== current.status) {
        reindexColumn(current.projectId, current.status)
        reindexColumn(current.projectId, status)
      }
      persistTodos()
      notify()
      return next
    },

    setProjectTodoStatus(todoId: string, status: ProjectTodoStatus): ProjectTodo | null {
      return this.updateProjectTodo(todoId, { status })
    },

    moveProjectTodo(
      todoId: string,
      toStatus: ProjectTodoStatus,
      toIndex?: number,
    ): ProjectTodo | null {
      const current = todos.find(t => t.id === todoId)
      if (!current) return null
      const key = current.projectId
      const fromStatus = current.status

      // Pull card out, then rebuild target column with insert.
      const others = todos.filter(t => t.id !== todoId)
      const targetColumn = sortTodos(
        others.filter(t => t.projectId === key && t.status === toStatus),
      )
      const insertAt =
        toIndex == null
          ? targetColumn.length
          : Math.max(0, Math.min(toIndex, targetColumn.length))
      const stamp = nowIso()
      const moved = withDerived({
        ...current,
        status: toStatus,
        completedAt: toStatus === "done" ? current.completedAt ?? stamp : undefined,
        updatedAt: stamp,
        position: insertAt,
      })
      targetColumn.splice(insertAt, 0, moved)
      const reindexedTarget = targetColumn.map((t, position) =>
        withDerived({ ...t, position, updatedAt: stamp }),
      )

      const rest = others.filter(
        t => !(t.projectId === key && t.status === toStatus),
      )
      todos = [...rest, ...reindexedTarget]
      if (fromStatus !== toStatus) {
        reindexColumn(key, fromStatus)
      }
      persistTodos()
      notify()
      return todos.find(t => t.id === todoId) ?? null
    },

    toggleProjectTodo(todoId: string): ProjectTodo | null {
      const current = todos.find(t => t.id === todoId)
      if (!current) return null
      return this.updateProjectTodo(todoId, {
        status: current.status === "done" ? "todo" : "done",
      })
    },

    deleteProjectTodo(todoId: string): boolean {
      const current = todos.find(t => t.id === todoId)
      if (!current) return false
      todos = todos.filter(t => t.id !== todoId)
      reindexColumn(current.projectId, current.status)
      persistTodos()
      notify()
      return true
    },

    reorderColumn(
      projectId: string,
      status: ProjectTodoStatus,
      orderedIds: string[],
    ): ProjectTodo[] {
      const key = projectTodoKey(projectId)
      const stamp = nowIso()
      const byId = new Map(
        todos
          .filter(t => t.projectId === key && t.status === status)
          .map(t => [t.id, t]),
      )
      const reordered: ProjectTodo[] = []
      orderedIds.forEach((id, position) => {
        const existing = byId.get(id)
        if (!existing) return
        reordered.push(withDerived({ ...existing, position, updatedAt: stamp }))
        byId.delete(id)
      })
      for (const leftover of byId.values()) {
        reordered.push(
          withDerived({
            ...leftover,
            position: reordered.length,
            updatedAt: stamp,
          }),
        )
      }
      const others = todos.filter(
        t => !(t.projectId === key && t.status === status),
      )
      todos = [...others, ...reordered]
      persistTodos()
      notify()
      return sortTodos(reordered)
    },

    reorderProjectTodos(projectId: string, orderedIds: string[]): ProjectTodo[] {
      const key = projectTodoKey(projectId)
      const others = todos.filter(t => t.projectId !== key)
      const byId = new Map(todos.filter(t => t.projectId === key).map(t => [t.id, t]))
      const reordered: ProjectTodo[] = []
      orderedIds.forEach((id, position) => {
        const existing = byId.get(id)
        if (!existing) return
        reordered.push(
          withDerived({
            ...existing,
            position,
            updatedAt: nowIso(),
          }),
        )
        byId.delete(id)
      })
      for (const leftover of byId.values()) {
        reordered.push(
          withDerived({
            ...leftover,
            position: reordered.length,
            updatedAt: nowIso(),
          }),
        )
      }
      todos = [...others, ...reordered]
      persistTodos()
      notify()
      return sortTodos(reordered)
    },

    isExpanded(projectId: string): boolean {
      return expanded[projectTodoKey(projectId)] === true
    },

    setExpanded(projectId: string, value: boolean): void {
      const key = projectTodoKey(projectId)
      if (value) expanded = { ...expanded, [key]: true }
      else {
        const next = { ...expanded }
        delete next[key]
        expanded = next
      }
      persistUi()
      notify()
    },

    hydrateFromStorage(): void {
      todos = sortTodos(readTodosDoc(storage).todos)
      expanded = { ...readUiDoc(storage).expanded }
      notify()
    },

    getRevision(): number {
      return revision
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    _resetForTests(nextStorage?: Storage): void {
      if (nextStorage) storage = nextStorage
      todos = []
      expanded = {}
      persistTodos()
      persistUi()
      notify()
    },
  }
}

/**
 * Shared app singleton.
 * Browser: ONLY `window.__gharargahProjectTodos` (survives dual Vite chunks / HMR).
 * Node tests: module-local fallback.
 */
let nodeRepo: ProjectTodosRepository | undefined

export function getSharedRepository(): ProjectTodosRepository {
  if (typeof window !== "undefined") {
    if (!window.__gharargahProjectTodos) {
      window.__gharargahProjectTodos = createProjectTodosRepository(defaultStorage())
    }
    return window.__gharargahProjectTodos
  }
  if (!nodeRepo) {
    nodeRepo = createProjectTodosRepository(defaultStorage())
  }
  return nodeRepo
}

declare global {
  interface Window {
    __gharargahProjectTodos?: ProjectTodosRepository
  }
}

/** Lazy proxy so Node tests can import without touching localStorage at load time. */
export const projectTodosRepository: ProjectTodosRepository = new Proxy(
  {} as ProjectTodosRepository,
  {
    get(_target, prop) {
      const repo = getSharedRepository()
      const value = Reflect.get(repo, prop as string | symbol, repo)
      return typeof value === "function" ? (value as (...args: never[]) => unknown).bind(repo) : value
    },
  },
)
