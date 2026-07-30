import assert from "node:assert/strict"
import { test } from "node:test"
import {
  isLegalSessionTransition,
  nextSessionStatus,
  type SessionLifecycleEvent,
  type TerminalSessionStatus,
} from "./session-machine.js"

const ALL: TerminalSessionStatus[] = ["starting", "running", "exited", "failed"]

test("status reducer matches product lifecycle", () => {
  assert.equal(nextSessionStatus("starting", { _tag: "PtyBound" }), "running")
  assert.equal(
    nextSessionStatus("starting", {
      _tag: "PtyBound",
      pendingExit: { exitCode: 1 },
    }),
    "exited",
  )
  assert.equal(
    nextSessionStatus("running", { _tag: "ProcessExited", exitCode: 0 }),
    "exited",
  )
  assert.equal(nextSessionStatus("running", { _tag: "Failed" }), "failed")
  assert.equal(nextSessionStatus("failed", { _tag: "AwaitResume" }), "starting")
  assert.equal(nextSessionStatus("exited", { _tag: "Restart" }), "starting")
  assert.equal(nextSessionStatus("running", { _tag: "MarkDone" }), "exited")
  assert.equal(nextSessionStatus("exited", { _tag: "MarkDone" }), "exited")
  assert.equal(nextSessionStatus("failed", { _tag: "MarkDone" }), "failed")
  assert.equal(nextSessionStatus("starting", { _tag: "PtyUnbound" }), "starting")
  assert.equal(
    nextSessionStatus("running", { _tag: "Hydrate", status: "exited" }),
    "exited",
  )
})

test("all current product events are legal from every status", () => {
  const events: SessionLifecycleEvent[] = [
    { _tag: "PtyBound" },
    { _tag: "PtyUnbound" },
    { _tag: "ProcessExited", exitCode: 0 },
    { _tag: "Failed" },
    { _tag: "AwaitResume" },
    { _tag: "Restart" },
    { _tag: "MarkDone" },
    { _tag: "Hydrate", status: "starting" },
  ]
  for (const status of ALL) {
    for (const event of events) {
      assert.equal(
        isLegalSessionTransition(status, event),
        true,
        `${status} + ${event._tag}`,
      )
    }
  }
})
