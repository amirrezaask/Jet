import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  readSessionRoster,
  writeSessionRoster,
  SESSION_ROSTER_STORAGE_KEY,
  type PersistedSessionRoster,
} from "./session-roster-store.js"

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial))
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

describe("session-roster-store", () => {
  it("round-trips sessions and modal", () => {
    const storage = memoryStorage()
    const roster: PersistedSessionRoster = {
      version: 1,
      sessions: [
        {
          tabId: "gharargah:terminal:session-1",
          cwdRootUri: "file:///tmp/proj",
          label: "Codex",
          launchCommand: "codex",
          ptyId: "term-1",
          status: "running",
          customLabel: "Codex",
        },
      ],
      modal: { tabId: "gharargah:terminal:session-1", sessionMode: "terminal" },
    }
    writeSessionRoster(roster, storage)
    assert.equal(storage.getItem(SESSION_ROSTER_STORAGE_KEY)?.includes("term-1"), true)
    assert.deepEqual(readSessionRoster(storage), roster)
  })

  it("ignores corrupt payloads and duplicate tab ids", () => {
    const storage = memoryStorage({
      [SESSION_ROSTER_STORAGE_KEY]: JSON.stringify({
        version: 1,
        sessions: [
          { tabId: "gharargah:terminal:a", cwdRootUri: "file:///a", label: "A", status: "running" },
          { tabId: "gharargah:terminal:a", cwdRootUri: "file:///b", label: "Dup", status: "failed" },
          { tabId: 12, cwdRootUri: "file:///c", label: "Bad" },
        ],
        modal: { tabId: "gharargah:terminal:missing", sessionMode: "terminal" },
      }),
    })
    const roster = readSessionRoster(storage)
    assert.equal(roster.sessions.length, 1)
    assert.equal(roster.sessions[0]?.tabId, "gharargah:terminal:a")
    assert.equal(roster.modal, null)
  })

  it("returns empty roster when storage empty", () => {
    assert.deepEqual(readSessionRoster(memoryStorage()), {
      version: 1,
      sessions: [],
      modal: null,
    })
  })
})
