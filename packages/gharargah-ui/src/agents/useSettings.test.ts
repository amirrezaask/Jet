import assert from "node:assert/strict"
import test from "node:test"
import {
  getClientSettingsSnapshot,
  getClientSettingsServerSnapshot,
  resetClientSettingsForTests,
  updateClientSettings,
} from "./useSettings.js"

function installMemoryLocalStorage(): void {
  const store = new Map<string, string>()
  const localStorage = {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null
    },
    setItem(key: string, value: string) {
      store.set(key, String(value))
    },
    removeItem(key: string) {
      store.delete(key)
    },
  }
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorage,
  })
}

test.beforeEach(() => {
  installMemoryLocalStorage()
  resetClientSettingsForTests()
})

test("getSnapshot stays referentially stable when favorites are persisted", () => {
  localStorage.setItem(
    "jet-agent-client-settings",
    JSON.stringify({ favorites: [{ provider: "codex", model: "gpt-5" }] }),
  )

  const first = getClientSettingsSnapshot()
  const second = getClientSettingsSnapshot()

  assert.equal(first, second)
  assert.equal(first.favorites.length, 1)
  assert.equal(first.favorites[0]?.provider, "codex")
})

test("getSnapshot stays stable across many reads (React useSyncExternalStore contract)", () => {
  localStorage.setItem(
    "jet-agent-client-settings",
    JSON.stringify({
      favorites: [
        { provider: "claude", model: "sonnet" },
        { provider: "cursor", model: "composer" },
      ],
    }),
  )

  const snapshots = Array.from({ length: 50 }, () => getClientSettingsSnapshot())
  for (const snapshot of snapshots) {
    assert.equal(snapshot, snapshots[0])
  }
})

test("server snapshot is stable empty defaults", () => {
  assert.equal(getClientSettingsServerSnapshot(), getClientSettingsServerSnapshot())
  assert.deepEqual(getClientSettingsServerSnapshot().favorites, [])
})

test("updates replace the snapshot reference once, then stay stable", () => {
  const before = getClientSettingsSnapshot()
  updateClientSettings({ favorites: [{ provider: "opencode", model: "big-pickle" }] })

  const after = getClientSettingsSnapshot()
  assert.notEqual(after, before)
  assert.equal(getClientSettingsSnapshot(), after)
  assert.equal(after.favorites[0]?.model, "big-pickle")

  const raw = localStorage.getItem("jet-agent-client-settings")
  assert.ok(raw)
  assert.equal(JSON.parse(raw!).favorites[0].provider, "opencode")
})

test("corrupt localStorage falls back without thrashing new objects each read", () => {
  localStorage.setItem("jet-agent-client-settings", "{not-json")
  const first = getClientSettingsSnapshot()
  const second = getClientSettingsSnapshot()
  assert.equal(first, second)
  assert.deepEqual(first.favorites, [])
})
