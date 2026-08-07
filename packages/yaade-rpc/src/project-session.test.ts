import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  emptyProjectSessionPayload,
  tryDecodeProjectSessionPayload,
} from "./project-session.js"

describe("project session editor view states", () => {
  it("round-trips JSON view state and drops invalid entries", () => {
    const payload = emptyProjectSessionPayload()
    const decoded = tryDecodeProjectSessionPayload({
      ...payload,
      editorViewStates: {
        "panel-1\0file:///workspace/a.ts": {
          position: { lineNumber: 9, column: 2 },
          scrollTop: 180,
        },
        invalid: "not an object",
      },
    })
    assert.deepEqual(decoded?.editorViewStates, {
      "panel-1\0file:///workspace/a.ts": {
        position: { lineNumber: 9, column: 2 },
        scrollTop: 180,
      },
    })
  })
})
