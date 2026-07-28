import assert from "node:assert/strict"
import test from "node:test"
import { createTerminalInputWriter } from "./terminal-input-writer.js"

test("coalesces same-turn input and preserves write order", async () => {
  const writes: string[] = []
  const writer = createTerminalInputWriter(
    async data => {
      writes.push(data)
    },
    error => assert.fail(String(error)),
  )

  writer.enqueue("a")
  writer.enqueue("b")
  await writer.flush()
  writer.enqueue("c")
  await writer.flush()

  assert.deepEqual(writes, ["ab", "c"])
})

test("reports rejected writes without producing an unhandled rejection", async () => {
  const errors: unknown[] = []
  const writer = createTerminalInputWriter(
    async () => {
      throw new Error("offline")
    },
    error => errors.push(error),
  )

  writer.enqueue("input")
  await writer.flush()
  assert.equal(errors.length, 1)
})
