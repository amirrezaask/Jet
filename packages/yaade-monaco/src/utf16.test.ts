import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { offsetToPosition, positionToOffset } from "./utf16.js"

describe("offsetToPosition / positionToOffset", () => {
  it("handles empty string", () => {
    assert.deepEqual(offsetToPosition("", 0), { line: 0, character: 0 })
    assert.equal(positionToOffset("", { line: 0, character: 0 }), 0)
  })

  it("handles single line ascii", () => {
    const text = "hello world"
    assert.deepEqual(offsetToPosition(text, 0), { line: 0, character: 0 })
    assert.deepEqual(offsetToPosition(text, 6), { line: 0, character: 6 })
    assert.equal(positionToOffset(text, { line: 0, character: 6 }), 6)
  })

  it("handles LF newlines", () => {
    const text = "foo\nbar\nbaz"
    assert.deepEqual(offsetToPosition(text, 4), { line: 1, character: 0 })
    assert.deepEqual(offsetToPosition(text, 7), { line: 1, character: 3 })
    assert.equal(positionToOffset(text, { line: 1, character: 0 }), 4)
    assert.equal(positionToOffset(text, { line: 2, character: 0 }), 8)
  })

  it("handles CRLF newlines", () => {
    const text = "foo\r\nbar\r\nbaz"
    assert.deepEqual(offsetToPosition(text, 5), { line: 1, character: 0 })
    assert.equal(positionToOffset(text, { line: 1, character: 0 }), 5)
    assert.equal(positionToOffset(text, { line: 2, character: 0 }), 10)
  })

  it("counts UTF-16 code units (emoji surrogate pair = 2)", () => {
    const text = "a😀b"
    assert.deepEqual(offsetToPosition(text, 1), { line: 0, character: 1 })
    assert.deepEqual(offsetToPosition(text, 2), { line: 0, character: 2 })
    assert.deepEqual(offsetToPosition(text, 3), { line: 0, character: 3 })
    assert.equal(positionToOffset(text, { line: 0, character: 2 }), 2)
    assert.equal(positionToOffset(text, { line: 0, character: 3 }), 3)
  })

  it("handles Persian text", () => {
    const text = "سلام\nدنیا"
    const secondLineStart = positionToOffset(text, { line: 1, character: 0 })
    assert.deepEqual(offsetToPosition(text, secondLineStart), { line: 1, character: 0 })
    const pos = offsetToPosition(text, secondLineStart + 2)
    assert.equal(pos.line, 1)
    assert.equal(positionToOffset(text, pos), secondLineStart + 2)
  })

  it("round-trips all offsets (LF newlines)", () => {
    const text = "line1\nline2😀end\nline3"
    for (let i = 0; i <= text.length; i++) {
      const pos = offsetToPosition(text, i)
      assert.equal(positionToOffset(text, pos), i, `failed at offset ${i}`)
    }
  })
})
