import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { PersistedSessionRoster } from "./session-roster-store.js"
import { SessionRosterWriter } from "./session-roster-writer.js"

function roster(label: string): PersistedSessionRoster {
  return {
    version: 2,
    sessions: [
      {
        tabId: `terminal:${label}`,
        cwdRootUri: "file:///tmp",
        label,
        status: "exited",
      },
    ],
    modal: null,
  }
}

async function settle(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve))
}

describe("SessionRosterWriter", () => {
  it("serializes writes and coalesces pending snapshots to the newest", async () => {
    const saved: string[] = []
    let releaseFirst: (() => void) | null = null
    const writer = new SessionRosterWriter(async snapshot => {
      saved.push(snapshot.sessions[0]?.label ?? "empty")
      if (saved.length === 1) {
        await new Promise<void>(resolve => {
          releaseFirst = resolve
        })
      }
      return snapshot
    })

    writer.enqueue(roster("one"))
    await settle()
    writer.enqueue(roster("two"))
    writer.enqueue(roster("three"))
    assert.deepEqual(saved, ["one"])

    releaseFirst?.()
    await settle()
    await settle()
    assert.deepEqual(saved, ["one", "three"])
    writer.stop()
  })

  it("retains a failed snapshot and retries it", async () => {
    const saved: string[] = []
    const retries: Array<() => void> = []
    let fail = true
    const writer = new SessionRosterWriter(
      async snapshot => {
        saved.push(snapshot.sessions[0]?.label ?? "empty")
        if (fail) {
          fail = false
          throw new Error("offline")
        }
        return snapshot
      },
      retry => {
        retries.push(retry)
        return () => {}
      },
    )

    writer.enqueue(roster("archive"))
    await settle()
    assert.deepEqual(saved, ["archive"])
    assert.equal(retries.length, 1)

    retries[0]?.()
    await settle()
    assert.deepEqual(saved, ["archive", "archive"])
    writer.stop()
  })

  it("uses a newer snapshot instead of retrying stale failed state", async () => {
    const saved: string[] = []
    const retries: Array<() => void> = []
    let releaseFailure: (() => void) | null = null
    const writer = new SessionRosterWriter(
      async snapshot => {
        saved.push(snapshot.sessions[0]?.label ?? "empty")
        if (saved.length === 1) {
          await new Promise<void>(resolve => {
            releaseFailure = resolve
          })
          throw new Error("offline")
        }
        return snapshot
      },
      retry => {
        retries.push(retry)
        return () => {}
      },
    )

    writer.enqueue(roster("old"))
    await settle()
    writer.enqueue(roster("new"))
    releaseFailure?.()
    await settle()
    assert.equal(retries.length, 1)

    retries[0]?.()
    await settle()
    assert.deepEqual(saved, ["old", "new"])
    writer.stop()
  })
})
