import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { computeDropZone } from "./panel-drop-zones.js"

const W = 1000
const H = 800

describe("computeDropZone — VS Code parity", () => {
  it("center merge in inner 80%×80%", () => {
    assert.equal(computeDropZone(500, 400, W, H), "center")
    assert.equal(computeDropZone(150, 120, W, H), "center")
    assert.equal(computeDropZone(850, 680, W, H), "center")
  })

  it("left split in left third outside center deadband", () => {
    assert.equal(computeDropZone(50, 400, W, H), "left")
  })

  it("right split in right third outside center deadband", () => {
    assert.equal(computeDropZone(950, 400, W, H), "right")
  })

  it("top split in middle column upper half", () => {
    assert.equal(computeDropZone(500, 50, W, H), "top")
  })

  it("bottom split in middle column lower half", () => {
    assert.equal(computeDropZone(500, 750, W, H), "bottom")
  })

  it("returns null for zero-size panel", () => {
    assert.equal(computeDropZone(0, 0, 0, H), null)
  })

  it("entire area is center when splitting disabled", () => {
    assert.equal(computeDropZone(50, 50, W, H, { enableSplitting: false }), "center")
  })
})
