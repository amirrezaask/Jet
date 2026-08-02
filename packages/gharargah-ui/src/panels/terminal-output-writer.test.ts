import assert from "node:assert/strict"
import test from "node:test"
import { createTerminalOutputWriter } from "./terminal-output-writer.js"

test("coalesces multiple enqueues into one write per flush", () => {
  const writes: string[] = []
  const scheduled: Array<() => void> = []
  const writer = createTerminalOutputWriter({
    write: (data, onPainted) => {
      writes.push(data)
      onPainted?.()
    },
    schedule: cb => {
      scheduled.push(cb)
      return scheduled.length
    },
    cancel: () => {},
  })

  writer.enqueue("a")
  writer.enqueue("b")
  writer.enqueue("c")
  assert.equal(writes.length, 0)
  assert.equal(scheduled.length, 1)
  scheduled[0]!()
  assert.deepEqual(writes, ["abc"])
})

test("marks cursor-visibility chunks for a single post-paint refresh", () => {
  let refreshes = 0
  const scheduled: Array<() => void> = []
  const writer = createTerminalOutputWriter({
    write: (_data, onPainted) => {
      onPainted?.()
    },
    refreshAfterPaint: () => {
      refreshes += 1
    },
    schedule: cb => {
      scheduled.push(cb)
      return scheduled.length
    },
    cancel: () => {},
  })

  writer.enqueue("hello")
  writer.enqueue("\x1b[?25l")
  writer.enqueue("\x1b[?25h")
  scheduled[0]!()
  assert.equal(refreshes, 1)
})

test("flush drains pending bytes without waiting for schedule", () => {
  const writes: string[] = []
  const writer = createTerminalOutputWriter({
    write: (data, onPainted) => {
      writes.push(data)
      onPainted?.()
    },
    schedule: () => 1,
    cancel: () => {},
  })

  writer.enqueue("attach-replay")
  writer.flush()
  assert.deepEqual(writes, ["attach-replay"])
})
