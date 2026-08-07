import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { EditorBufferVersionToken } from "./editor-buffer-version.js"

describe("EditorBufferVersionToken", () => {
  it("tracks edits and undo-to-saved without comparing document text", () => {
    const token = new EditorBufferVersionToken(4)
    assert.equal(token.isDirty(4), false)
    assert.equal(token.isDirty(5), true)
    assert.equal(token.isDirty(4), false)
  })

  it("moves the saved token after a successful save", () => {
    const token = new EditorBufferVersionToken(2)
    token.markSaved(8)
    assert.equal(token.savedVersion(), 8)
    assert.equal(token.isDirty(8), false)
  })
})
