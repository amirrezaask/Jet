import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import {
  PROJECT_TODOS_STORAGE_KEY,
  createProjectTodosRepository,
  projectTodoKey,
  type ProjectTodosRepository,
} from "./project-todos-repository.js"

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear() {
      map.clear()
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null
    },
    key(index: number) {
      return [...map.keys()][index] ?? null
    },
    removeItem(key: string) {
      map.delete(key)
    },
    setItem(key: string, value: string) {
      map.set(key, value)
    },
  }
}

describe("project-todos-store", () => {
  let repo: ProjectTodosRepository
  let storage: Storage

  beforeEach(() => {
    storage = memoryStorage()
    repo = createProjectTodosRepository(storage)
  })

  it("projectTodoKey normalizes paths", () => {
    assert.equal(projectTodoKey("/tmp/proj"), projectTodoKey("/tmp/proj/"))
  })

  it("rejects empty text", () => {
    assert.equal(repo.createProjectTodo("/proj/a", { text: "   " }), null)
  })

  it("creates, lists, toggles, updates, deletes", () => {
    const a = repo.createProjectTodo("/proj/a", { text: "Ship todos" })
    assert.ok(a)
    assert.equal(a.text, "Ship todos")
    assert.equal(a.completed, false)
    assert.equal(repo.listProjectTodos("/proj/a").length, 1)
    assert.equal(repo.listProjectTodos("/proj/b").length, 0)

    const toggled = repo.toggleProjectTodo(a.id)
    assert.ok(toggled?.completed)
    assert.ok(toggled?.completedAt)

    const updated = repo.updateProjectTodo(a.id, { text: "Ship feature" })
    assert.equal(updated?.text, "Ship feature")

    assert.equal(repo.deleteProjectTodo(a.id), true)
    assert.equal(repo.listProjectTodos("/proj/a").length, 0)
  })

  it("reorders within a project", () => {
    const first = repo.createProjectTodo("/proj/a", { text: "A" })!
    const second = repo.createProjectTodo("/proj/a", { text: "B" })!
    const third = repo.createProjectTodo("/proj/a", { text: "C" })!
    repo.reorderProjectTodos("/proj/a", [third.id, first.id, second.id])
    const texts = repo.listProjectTodos("/proj/a").map(t => t.text)
    assert.deepEqual(texts, ["C", "A", "B"])
  })

  it("persists across repository instances", () => {
    repo.createProjectTodo("/proj/a", { text: "Persist me" })
    repo.setExpanded("/proj/a", true)
    const reloaded = createProjectTodosRepository(storage)
    assert.equal(reloaded.listProjectTodos("/proj/a")[0]?.text, "Persist me")
    assert.equal(reloaded.isExpanded("/proj/a"), true)
  })

  it("migrates legacy title/description into text", () => {
    storage.setItem(
      PROJECT_TODOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        todos: [
          {
            id: "legacy-1",
            projectId: "/proj/a",
            title: "Old title",
            description: "Old body",
            completed: false,
            position: 0,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    )
    const migrated = createProjectTodosRepository(storage)
    assert.equal(migrated.listProjectTodos("/proj/a")[0]?.text, "Old title\nOld body")
  })

  it("keeps projects independent", () => {
    repo.createProjectTodo("/proj/a", { text: "A1" })
    repo.createProjectTodo("/proj/b", { text: "B1" })
    assert.equal(repo.listProjectTodos("/proj/a").length, 1)
    assert.equal(repo.listProjectTodos("/proj/b").length, 1)
  })

  it("notifies subscribers", () => {
    let hits = 0
    const unsub = repo.subscribe(() => {
      hits += 1
    })
    repo.createProjectTodo("/proj/a", { text: "Notify" })
    assert.equal(hits, 1)
    unsub()
    repo.createProjectTodo("/proj/a", { text: "Silent" })
    assert.equal(hits, 1)
  })

  it("hydrateFromStorage reloads disk into memory", () => {
    repo.createProjectTodo("/proj/a", { text: "Keep" })
    storage.setItem(
      PROJECT_TODOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        todos: [
          {
            id: "disk-1",
            projectId: "/proj/a",
            text: "From disk",
            completed: false,
            position: 0,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    )
    repo.hydrateFromStorage()
    const listed = repo.listProjectTodos("/proj/a")
    assert.equal(listed.length, 1)
    assert.equal(listed[0]?.text, "From disk")
  })
})
