import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  LEGACY_SESSION_ROSTER_STORAGE_KEY,
  SESSION_ROSTER_STORAGE_KEY,
  type PersistedSessionRoster,
} from "./session-roster-store.js"
import { migrateLegacyLocalSessionRoster } from "./server-sessions.js"

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

describe("migrateLegacyLocalSessionRoster", () => {
  it("pushes local roster when server empty, then clears keys", async () => {
    const local: PersistedSessionRoster = {
      version: 2,
      sessions: [
        {
          tabId: "gharargah:terminal:a",
          cwdRootUri: "file:///tmp/a",
          label: "A",
          status: "running",
          ptyId: "term-a",
        },
      ],
      modal: null,
    }
    const storage = memoryStorage({
      [SESSION_ROSTER_STORAGE_KEY]: JSON.stringify(local),
    })
    let saved: PersistedSessionRoster | null = null
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/api/v1/sessions") && (!init || init.method === "GET")) {
        return new Response(
          JSON.stringify({ version: 2, sessions: [], modal: null }),
          { status: 200 },
        )
      }
      if (url.endsWith("/api/v1/sessions") && init?.method === "PUT") {
        saved = JSON.parse(String(init.body)) as PersistedSessionRoster
        return new Response(JSON.stringify(saved), { status: 200 })
      }
      throw new Error(`unexpected fetch ${url}`)
    }) as typeof fetch

    try {
      await migrateLegacyLocalSessionRoster(storage)
      assert.equal(saved?.sessions[0]?.tabId, "gharargah:terminal:a")
      assert.equal(storage.getItem(SESSION_ROSTER_STORAGE_KEY), null)
      assert.equal(storage.getItem(LEGACY_SESSION_ROSTER_STORAGE_KEY), null)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("clears local keys without overwrite when server already has sessions", async () => {
    const storage = memoryStorage({
      [SESSION_ROSTER_STORAGE_KEY]: JSON.stringify({
        version: 2,
        sessions: [
          {
            tabId: "gharargah:terminal:local",
            cwdRootUri: "file:///tmp/local",
            label: "Local",
            status: "running",
          },
        ],
        modal: null,
      }),
    })
    let putCalled = false
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/api/v1/sessions") && (!init || init.method === "GET")) {
        return new Response(
          JSON.stringify({
            version: 2,
            sessions: [
              {
                tabId: "gharargah:terminal:server",
                cwdRootUri: "file:///tmp/server",
                label: "Server",
                status: "running",
                ptyId: "term-server",
              },
            ],
            modal: null,
          }),
          { status: 200 },
        )
      }
      if (init?.method === "PUT") {
        putCalled = true
        return new Response("{}", { status: 200 })
      }
      throw new Error(`unexpected fetch ${url}`)
    }) as typeof fetch

    try {
      await migrateLegacyLocalSessionRoster(storage)
      assert.equal(putCalled, false)
      assert.equal(storage.getItem(SESSION_ROSTER_STORAGE_KEY), null)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
