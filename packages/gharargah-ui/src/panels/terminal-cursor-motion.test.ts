import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  shouldEmitTerminalGhost,
  terminalCaretPoint,
} from "./terminal-cursor-motion.js"

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

describe("shouldEmitTerminalGhost", () => {
  const previous = { x: 8, y: 16, h: 16, charWidth: 8 }
  const next = { x: 16, y: 16, h: 16, charWidth: 8 }
  const base = {
    active: true,
    documentVisible: true,
    focused: true,
    motion: "trail" as const,
    reduced: false,
    previous,
    next,
  }

  it("emits only a previous-position ghost while the native caret moves", () => {
    assert.equal(shouldEmitTerminalGhost(base), true)
    assert.equal(shouldEmitTerminalGhost({ ...base, next: previous }), false)
  })

  it("does not emit while unfocused, inactive, hidden, or reduced", () => {
    assert.equal(shouldEmitTerminalGhost({ ...base, focused: false }), false)
    assert.equal(shouldEmitTerminalGhost({ ...base, active: false }), false)
    assert.equal(shouldEmitTerminalGhost({ ...base, documentVisible: false }), false)
    assert.equal(shouldEmitTerminalGhost({ ...base, reduced: true }), false)
  })

  it("does not add terminal overlays for smooth or off motion", () => {
    assert.equal(shouldEmitTerminalGhost({ ...base, motion: "smooth" }), false)
    assert.equal(shouldEmitTerminalGhost({ ...base, motion: "off" }), false)
  })

  it("requires both a previous and current native caret position", () => {
    assert.equal(shouldEmitTerminalGhost({ ...base, previous: null }), false)
    assert.equal(shouldEmitTerminalGhost({ ...base, next: null }), false)
  })
})
