import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { terminalCaretPoint } from "./terminal-cursor-motion.js"

describe("terminalCaretPoint", () => {
  it("places the caret with measured cell metrics, not screen/cols guesses", () => {
    const point = terminalCaretPoint({
      cols: 80,
      rows: 24,
      cursorX: 2,
      cursorY: 10,
      cellWidth: 9,
      cellHeight: 18,
    })
    assert.deepEqual(point, { x: 18, y: 180, h: 18, charWidth: 9 })
  })

  it("clamps to the visible grid", () => {
    const point = terminalCaretPoint({
      cols: 10,
      rows: 5,
      cursorX: 99,
      cursorY: 99,
      cellWidth: 8,
      cellHeight: 16,
    })
    assert.deepEqual(point, { x: 72, y: 64, h: 16, charWidth: 8 })
  })

  it("returns null when cell metrics are not ready", () => {
    assert.equal(
      terminalCaretPoint({
        cols: 80,
        rows: 24,
        cursorX: 0,
        cursorY: 0,
        cellWidth: 0,
        cellHeight: 0,
      }),
      null,
    )
  })
})
