import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type {
  AgentCliHistoryProvider,
  AgentCliHistoryResult,
} from "@gharargah/shared"
import {
  buildAgentCliHistoryPrefetchTargets,
  clearAgentCliHistoryCache,
  ensureAgentCliHistory,
  peekAgentCliHistory,
  startAgentCliHistoryPrefetch,
} from "./background-agent-cli-history.js"

function deferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (error: Error) => void
} {
  let resolve: (value: T) => void = () => {}
  let reject: (error: Error) => void = () => {}
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

async function flush(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve))
}

function ready(
  provider: AgentCliHistoryProvider,
  id = "ses_1",
): AgentCliHistoryResult {
  return {
    provider,
    state: "ready",
    sessions: [
      {
        id,
        provider,
        title: `${provider} session`,
        cwd: "/tmp/proj",
        createdAt: null,
        updatedAt: null,
      },
    ],
  }
}

describe("agent CLI history prefetch worker", () => {
  it("builds provider × cwd targets", () => {
    assert.deepEqual(buildAgentCliHistoryPrefetchTargets(["/a", " /b "], ["codex", "grok"]), [
      { provider: "codex", cwd: "/a" },
      { provider: "grok", cwd: "/a" },
      { provider: "codex", cwd: "/b" },
      { provider: "grok", cwd: "/b" },
    ])
  })

  it("caches ensure results and peeks synchronously", async () => {
    clearAgentCliHistoryCache()
    let calls = 0
    const listCliSessions = async () => {
      calls += 1
      return ready("opencode")
    }
    const first = await ensureAgentCliHistory({
      listCliSessions,
      provider: "opencode",
      cwd: "/tmp/proj",
    })
    const second = await ensureAgentCliHistory({
      listCliSessions,
      provider: "opencode",
      cwd: "/tmp/proj",
    })
    assert.equal(calls, 1)
    assert.equal(first, second)
    assert.equal(peekAgentCliHistory("opencode", "/tmp/proj"), first)
  })

  it("dedupes in-flight ensure calls", async () => {
    clearAgentCliHistoryCache()
    const gate = deferred<AgentCliHistoryResult>()
    let calls = 0
    const listCliSessions = () => {
      calls += 1
      return gate.promise
    }
    const a = ensureAgentCliHistory({
      listCliSessions,
      provider: "codex",
      cwd: "/tmp/proj",
    })
    const b = ensureAgentCliHistory({
      listCliSessions,
      provider: "codex",
      cwd: "/tmp/proj",
    })
    assert.equal(calls, 1)
    gate.resolve(ready("codex"))
    const [ra, rb] = await Promise.all([a, b])
    assert.equal(ra, rb)
  })

  it("prefetches with concurrency and skips already-cached targets", async () => {
    clearAgentCliHistoryCache()
    const gates = new Map<string, ReturnType<typeof deferred<AgentCliHistoryResult>>>()
    const order: string[] = []
    const listCliSessions: (
      req: { provider: AgentCliHistoryProvider; cwd: string },
    ) => Promise<AgentCliHistoryResult> = req => {
      const key = `${req.provider}:${req.cwd}`
      order.push(`start:${key}`)
      const gate = deferred<AgentCliHistoryResult>()
      gates.set(key, gate)
      return gate.promise.then(result => {
        order.push(`done:${key}`)
        return result
      })
    }

    await ensureAgentCliHistory({
      listCliSessions: async () => ready("codex", "cached"),
      provider: "codex",
      cwd: "/a",
    })

    const run = startAgentCliHistoryPrefetch({
      listCliSessions,
      concurrency: 2,
      targets: [
        { provider: "codex", cwd: "/a" },
        { provider: "opencode", cwd: "/a" },
        { provider: "grok", cwd: "/a" },
        { provider: "opencode", cwd: "/b" },
      ],
    })

    await flush()
    assert.equal(gates.size, 2)
    assert.ok(gates.has("opencode:/a"))
    assert.ok(gates.has("grok:/a"))

    gates.get("opencode:/a")!.resolve(ready("opencode"))
    await flush()
    assert.ok(gates.has("opencode:/b"))

    gates.get("grok:/a")!.resolve(ready("grok"))
    gates.get("opencode:/b")!.resolve(ready("opencode", "b"))
    const summary = await run.done
    assert.equal(summary.eligible, 3)
    assert.equal(summary.loaded, 3)
    assert.equal(summary.failed, 0)
    assert.equal(summary.skipped, 0)
    assert.equal(summary.maxInFlight, 2)
    assert.equal(peekAgentCliHistory("opencode", "/a")?.sessions[0]?.id, "ses_1")
  })

  it("cancel skips queued jobs", async () => {
    clearAgentCliHistoryCache()
    const gate = deferred<AgentCliHistoryResult>()
    const listCliSessions = () => gate.promise
    const run = startAgentCliHistoryPrefetch({
      listCliSessions,
      concurrency: 1,
      targets: [
        { provider: "codex", cwd: "/a" },
        { provider: "opencode", cwd: "/a" },
      ],
    })
    await flush()
    run.cancel()
    gate.resolve(ready("codex"))
    const summary = await run.done
    assert.equal(summary.eligible, 2)
    assert.equal(summary.skipped, 1)
    assert.equal(summary.loaded + summary.failed, 1)
  })
})
