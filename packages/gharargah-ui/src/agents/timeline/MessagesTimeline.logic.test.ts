import assert from "node:assert/strict"
import test from "node:test"
import {
  resolveTimelineIsAtEnd,
  resolveTimelineMinimapHasPersistentGutter,
  resolveTimelineMinimapIndexFromPointer,
  resolveTimelineMinimapTopPercent,
} from "./MessagesTimeline.logic.js"

test("resolveTimelineIsAtEnd prefers near-end over strict end", () => {
  assert.equal(resolveTimelineIsAtEnd({ isAtEnd: false, isNearEnd: true }), true)
  assert.equal(resolveTimelineIsAtEnd({ isAtEnd: true }), true)
  assert.equal(resolveTimelineIsAtEnd(undefined), undefined)
})

test("minimap pointer mapping clamps to item range", () => {
  assert.equal(
    resolveTimelineMinimapIndexFromPointer({
      itemCount: 5,
      railTop: 0,
      railHeight: 100,
      pointerY: 0,
    }),
    0,
  )
  assert.equal(
    resolveTimelineMinimapIndexFromPointer({
      itemCount: 5,
      railTop: 0,
      railHeight: 100,
      pointerY: 100,
    }),
    4,
  )
  assert.equal(
    resolveTimelineMinimapIndexFromPointer({
      itemCount: 0,
      railTop: 0,
      railHeight: 100,
      pointerY: 50,
    }),
    null,
  )
})

test("minimap top percent and gutter helpers", () => {
  assert.equal(resolveTimelineMinimapTopPercent(0, 1), 0)
  assert.equal(resolveTimelineMinimapTopPercent(2, 5), 50)
  assert.equal(resolveTimelineMinimapHasPersistentGutter(1600), true)
  assert.equal(resolveTimelineMinimapHasPersistentGutter(400), false)
})
