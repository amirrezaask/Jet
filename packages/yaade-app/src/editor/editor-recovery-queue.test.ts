import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { EditorRecoveryQueue } from "./editor-recovery-queue.js"

function deferred(): {
  promise: Promise<void>
  resolve: () => void
} {
  let resolve!: () => void
  return {
    promise: new Promise<void>(done => {
      resolve = done
    }),
    resolve,
  }
}

describe("EditorRecoveryQueue", () => {
  it("keeps writes ordered per URI", async () => {
    const queue = new EditorRecoveryQueue()
    const first = deferred()
    const started = deferred()
    const calls: string[] = []
    let stored = ""

    const older = queue.enqueue("file:///a.ts", async () => {
      calls.push("older:start")
      started.resolve()
      await first.promise
      stored = "older"
      calls.push("older:end")
    })
    const newer = queue.enqueue("file:///a.ts", async () => {
      calls.push("newer")
      stored = "newer"
    })

    await started.promise
    assert.deepEqual(calls, ["older:start"])
    first.resolve()
    await Promise.all([older, newer])
    assert.equal(stored, "newer")
    assert.deepEqual(calls, ["older:start", "older:end", "newer"])
  })

  it("runs deletion after an in-flight write and does not resurrect it", async () => {
    const queue = new EditorRecoveryQueue()
    const write = deferred()
    let stored: string | null = null

    const pendingWrite = queue.enqueue("file:///a.ts", async () => {
      await write.promise
      stored = "stale"
    })
    const pendingDelete = queue.enqueue("file:///a.ts", async () => {
      stored = null
    })

    write.resolve()
    await Promise.all([pendingWrite, pendingDelete])
    assert.equal(stored, null)
  })

  it("continues after a failed operation", async () => {
    const queue = new EditorRecoveryQueue()
    const failure = queue.enqueue("file:///a.ts", async () => {
      throw new Error("quota")
    })
    let ran = false
    const next = queue.enqueue("file:///a.ts", async () => {
      ran = true
    })

    await assert.rejects(failure, /quota/)
    await next
    await queue.waitForIdle()
    assert.equal(ran, true)
  })
})
