import assert from "node:assert/strict"
import test from "node:test"
import { DEFAULT_MUX_STATE, readMuxState, writeMuxState } from "./store.js"

test("readMuxState defaults to horizontal orientation", () => {
  const memory = new Map<string, string>()
  const storage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memory.set(k, v)
    },
  }
  const state = readMuxState(storage)
  assert.equal(state.version, 2)
  assert.equal(state.orientation, "horizontal")
  assert.deepEqual(state.gitRoots, {})
})

test("readMuxState migrates v1 and preserves windows", () => {
  const memory = new Map<string, string>()
  memory.set(
    "yaade-mux-v1",
    JSON.stringify({
      version: 1,
      orientation: "vertical",
      windows: [
        {
          id: "win-1",
          title: "T",
          tree: { version: 1, root: { kind: "leaf", panelId: { id: 1 } }, views: {} },
          focusedPaneId: 1,
          zoomedPaneId: null,
          paneOrder: ["yaade:terminal:x"],
        },
      ],
      activeWindowId: "win-1",
      lastCwdUri: "file:///tmp",
    }),
  )
  const storage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memory.set(k, v)
    },
  }
  const state = readMuxState(storage)
  assert.equal(state.version, 2)
  assert.equal(state.orientation, "vertical")
  assert.equal(state.windows.length, 1)
  assert.equal(state.activeWindowId, "win-1")
  assert.equal(state.lastCwdUri, "file:///tmp")
})

test("writeMuxState persists gitRoots and version 2", () => {
  const memory = new Map<string, string>()
  const storage = {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memory.set(k, v)
    },
  }
  writeMuxState(
    {
      ...DEFAULT_MUX_STATE,
      gitRoots: { "yaade:git:1": "file:///tmp/repo" },
      lastCwdUri: "file:///home",
    },
    storage,
  )
  const raw = JSON.parse(memory.get("yaade-mux-v1")!)
  assert.equal(raw.version, 2)
  assert.equal(raw.gitRoots["yaade:git:1"], "file:///tmp/repo")
})
