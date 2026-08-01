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

test("event replay preserves sequence order after repeated queue compaction", () => {
  const events = new EventHub(128, 1024 * 1024)
  for (let index = 0; index < 10_000; index += 1) {
    events.emit("terminal:data", ["pty", "output", index])
  }

  const replay = events.replayAfter(9_950)
  assert.deepEqual(
    replay.map(event => event.sequence),
    Array.from({ length: 50 }, (_, index) => 9_951 + index),
  )
})
