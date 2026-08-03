import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  consumePendingEditorNavigation,
  consumePendingInitialContent,
  setPendingEditorNavigation,
  setPendingInitialContent,
} from "./pending-editor.js"

describe("pending editor state", () => {
  it("canonicalizes equivalent file URIs", () => {
    setPendingEditorNavigation("file:///tmp/project file.ts", {
      line: 12,
      column: 4,
    })
    assert.deepEqual(
      consumePendingEditorNavigation("file:///tmp/project%20file.ts"),
      { line: 12, column: 4 },
    )
  })

  it("bounds never-consumed initial content", () => {
    for (let i = 0; i < 257; i++) {
      setPendingInitialContent(`untitled:pending-${i}`, String(i))
    }
    assert.equal(consumePendingInitialContent("untitled:pending-0"), undefined)
    assert.equal(consumePendingInitialContent("untitled:pending-256"), "256")
  })
})
