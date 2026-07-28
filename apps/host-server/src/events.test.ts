import assert from "node:assert/strict"
import test from "node:test"
import { EventHub } from "./events.js"

test("event replay is bounded by both count and serialized bytes", () => {
  const events = new EventHub(3, 220)
  for (let index = 0; index < 6; index += 1) {
    events.emit("terminal:data", ["pty", "x".repeat(80), index])
  }
  const replay = events.replayAfter(0)
  assert.ok(replay.length >= 1)
  assert.ok(replay.length <= 3)
  assert.equal(replay.at(-1)?.sequence, 6)
})
