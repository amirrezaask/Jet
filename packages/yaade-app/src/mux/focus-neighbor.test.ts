import assert from "node:assert/strict"
import test from "node:test"
import { findFocusNeighbor } from "./focus-neighbor.js"

test("findFocusNeighbor picks the closest pane in direction", () => {
  const panes = [
    {
      panelId: { id: 1 },
      ptyTabId: "a",
      box: { top: 0, left: 0, width: 100, height: 100 },
    },
    {
      panelId: { id: 2 },
      ptyTabId: "b",
      box: { top: 0, left: 120, width: 100, height: 100 },
    },
    {
      panelId: { id: 3 },
      ptyTabId: "c",
      box: { top: 120, left: 0, width: 100, height: 100 },
    },
  ]
  const right = findFocusNeighbor(panes, { id: 1 }, "right")
  assert.equal(right?.ptyTabId, "b")
  const down = findFocusNeighbor(panes, { id: 1 }, "down")
  assert.equal(down?.ptyTabId, "c")
  const left = findFocusNeighbor(panes, { id: 2 }, "left")
  assert.equal(left?.ptyTabId, "a")
  assert.equal(findFocusNeighbor(panes, { id: 1 }, "left"), null)
})
