import assert from "node:assert/strict"
import test from "node:test"
import { EventHub } from "./events.js"

test("event replay is bounded by both count and serialized bytes", () => {
  const events = new EventHub(3, 220)
  for (let index = 0; index < 6; index += 1) {
    events.emit("fs:changed", [`file://x-${index}-${"y".repeat(40)}`])
  }
  const replay = events.replayAfter(0)
  assert.ok(replay.length >= 1)
  assert.ok(replay.length <= 3)
  assert.equal(replay.at(-1)?.sequence, 6)
})

test("event replay preserves sequence order after repeated queue compaction", () => {
  const events = new EventHub(128, 1024 * 1024)
  for (let index = 0; index < 10_000; index += 1) {
    events.emit("fs:changed", [`file://path-${index}`])
  }

  const replay = events.replayAfter(9_950)
  assert.deepEqual(
    replay.map(event => event.sequence),
    Array.from({ length: 50 }, (_, index) => 9_951 + index),
  )
})

test("terminal:data is live-only — never retained in replay history", () => {
  const events = new EventHub(64, 1024 * 1024)
  const seen: string[] = []
  events.subscribe(event => {
    if (event.channel === "terminal:data") seen.push(String(event.args[1]))
  })

  events.emit("notifications:event", [{ type: "keep-me" }])
  for (let index = 0; index < 500; index += 1) {
    events.emit("terminal:data", ["pty", `chunk-${index}`, index])
  }
  events.emit("fs:changed", ["file://after-flood"])

  assert.equal(seen.length, 500)
  const replay = events.replayAfter(0)
  assert.equal(
    replay.some(event => event.channel === "terminal:data"),
    false,
  )
  assert.deepEqual(
    replay.map(event => event.channel),
    ["notifications:event", "fs:changed"],
  )
  // Sequences still advance for ephemeral frames.
  assert.equal(events.lastSequence, 502)
  assert.equal(replay[0]?.sequence, 1)
  assert.equal(replay[1]?.sequence, 502)
})
