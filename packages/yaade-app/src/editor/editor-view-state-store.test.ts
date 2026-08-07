import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"
import {
  clearEditorViewStates,
  getEditorViewState,
  replaceEditorViewStates,
  setEditorViewState,
  snapshotEditorViewStates,
} from "./editor-view-state-store.js"

const sessionId = "ses-view-state-test"

afterEach(() => clearEditorViewStates(sessionId))

describe("editor view state store", () => {
  it("persists state per panel and URI", () => {
    const state = { position: { lineNumber: 8, column: 3 }, scrollTop: 120 }
    setEditorViewState(sessionId, "panel-1", "file:///a.ts", state)
    assert.deepEqual(
      getEditorViewState(sessionId, "panel-1", "file:///a.ts"),
      state,
    )
    assert.equal(getEditorViewState(sessionId, "panel-2", "file:///a.ts"), null)
  })

  it("round-trips a session snapshot and ignores invalid values", () => {
    replaceEditorViewStates(sessionId, {
      "panel-1\0file:///a.ts": { scrollTop: 44 },
      invalid: "not an object",
    })
    assert.deepEqual(snapshotEditorViewStates(sessionId), {
      "panel-1\0file:///a.ts": { scrollTop: 44 },
    })
  })
})
