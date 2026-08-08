import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"
import {
  clearEditorViewStates,
  getEditorViewState,
  remapEditorViewStateUri,
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

  it("remaps every pane state when Save As changes the buffer URI", () => {
    const oldUri = "untitled:New File-1"
    const newUri = "file:///project/new-file.ts"
    setEditorViewState(sessionId, "panel-1", oldUri, { scrollTop: 44 })
    setEditorViewState(sessionId, "panel-2", oldUri, {
      position: { lineNumber: 8, column: 3 },
    })

    remapEditorViewStateUri(sessionId, oldUri, newUri)

    assert.equal(getEditorViewState(sessionId, "panel-1", oldUri), null)
    assert.deepEqual(getEditorViewState(sessionId, "panel-1", newUri), {
      scrollTop: 44,
    })
    assert.deepEqual(getEditorViewState(sessionId, "panel-2", newUri), {
      position: { lineNumber: 8, column: 3 },
    })
  })
})
