import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { JetElectronTerminal } from "@yaade/workspace"
import {
  isActiveAgentWarmResumeCandidate,
  startActiveAgentCliWarmResume,
} from "./background-agent-cli-resume.js"
import type { TerminalSessionState } from "./tabs/terminal-session.js"

const CLI_ID = "11111111-1111-4111-8111-111111111111"

function session(
  tabId: string,
  overrides: Partial<TerminalSessionState> = {},
): TerminalSessionState {
  return {
    tabId,
    cwdRootUri: `file:///tmp/${tabId}`,
    launchCommand: "codex",
    launchArgs: ["resume", CLI_ID],
    status: "starting",
    generation: 0,
    agentId: "codex",
    agentCliSessionId: CLI_ID,
    hasUserInput: false,
    hasMeaningfulOutput: false,
    lastActivityAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  }
}

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

describe("active agent CLI warm resume", () => {
  it("selects only unarchived provider sessions with valid resume argv", () => {
    assert.equal(isActiveAgentWarmResumeCandidate(session("active")), true)
    assert.equal(
      isActiveAgentWarmResumeCandidate(
        session("archived", { archivedAt: "2026-08-01T01:00:00.000Z" }),
      ),
      false,
    )
    assert.equal(
      isActiveAgentWarmResumeCandidate(session("live", { ptyId: "term-live" })),
      false,
    )
    assert.equal(
      isActiveAgentWarmResumeCandidate(
        session("fresh", { agentCliSessionId: undefined, launchArgs: [] }),
      ),
      false,
    )
    assert.equal(
      isActiveAgentWarmResumeCandidate(
        session("wrong-argv", { launchArgs: ["--resume", CLI_ID] }),
      ),
      false,
    )
    assert.equal(
      isActiveAgentWarmResumeCandidate(
        session("wrong-command", { launchCommand: "/bin/sh" }),
      ),
      false,
    )
    assert.equal(
      isActiveAgentWarmResumeCandidate(
        session("wrong-id", {
          launchArgs: ["resume", "22222222-2222-4222-8222-222222222222"],
        }),
      ),
      false,
    )
  })

  it("derives executable metadata instead of trusting persisted env or argv", async () => {
    const active = session("trusted", {
      launchEnv: { MALICIOUS: "1" },
      launchArgs: ["resume", CLI_ID, "--dangerous-persisted-flag"],
    })
    let received:
      | { command?: string; args?: string[]; env?: Record<string, string> }
      | undefined
    const terminal = {
      async create(_cwd: string, launch?: typeof received) {
        received = launch
        return { id: "trusted-pty" }
      },
      async dispose() {},
    } satisfies Pick<JetElectronTerminal, "create" | "dispose">
    const run = startActiveAgentCliWarmResume({
      terminal,
      sessions: [active],
      getSession: () => active,
      onPtyCreated() {},
      attempts: 1,
      origin: "http://127.0.0.1:4747",
    })
    await run.done
    assert.equal(received?.command, "codex")
    assert.deepEqual(received?.args?.slice(0, 2), ["resume", CLI_ID])
    assert.equal(received?.args?.includes("--dangerous-persisted-flag"), false)
    assert.equal(received?.env?.MALICIOUS, undefined)
    assert.equal(received?.env?.YAADE_SESSION_ID, "trusted")
  })

  it("bounds concurrent provider spawns and records deterministic timing", async () => {
    const sessions = [session("one"), session("two"), session("three")]
    const live = new Map(sessions.map(item => [item.tabId, item]))
    const creates: Array<ReturnType<typeof deferred<{ id: string }>>> = []
    let inFlight = 0
    let maxInFlight = 0
    const terminal = {
      create() {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        const gate = deferred<{ id: string }>()
        creates.push(gate)
        return gate.promise.finally(() => {
          inFlight -= 1
        })
      },
      async dispose() {},
    } satisfies Pick<JetElectronTerminal, "create" | "dispose">
    const ptys: string[] = []
    const times = [10, 35]
    const run = startActiveAgentCliWarmResume({
      terminal,
      sessions,
      getSession: tabId => live.get(tabId),
      onPtyCreated: (_tabId, ptyId) => ptys.push(ptyId),
      concurrency: 2,
      attempts: 1,
      now: () => times.shift() ?? 35,
    })

    await flush()
    assert.equal(creates.length, 2)
    assert.equal(maxInFlight, 2)
    creates[0]!.resolve({ id: "pty-one" })
    await flush()
    assert.equal(creates.length, 3)
    creates[1]!.resolve({ id: "pty-two" })
    creates[2]!.resolve({ id: "pty-three" })

    const summary = await run.done
    assert.deepEqual(ptys, ["pty-one", "pty-two", "pty-three"])
    assert.deepEqual(summary, {
      eligible: 3,
      resumed: 3,
      failed: 0,
      skipped: 0,
      maxInFlight: 2,
      durationMs: 25,
    })
  })

  it("promotes the selected session without duplicating a running spawn", async () => {
    const sessions = [session("one"), session("two"), session("three")]
    const live = new Map(sessions.map(item => [item.tabId, item]))
    const started: string[] = []
    const gates = new Map<string, ReturnType<typeof deferred<{ id: string }>>>()
    const terminal = {
      create(cwdRootUri: string) {
        const tabId = cwdRootUri.slice(cwdRootUri.lastIndexOf("/") + 1)
        started.push(tabId)
        const gate = deferred<{ id: string }>()
        gates.set(tabId, gate)
        return gate.promise
      },
      async dispose() {},
    } satisfies Pick<JetElectronTerminal, "create" | "dispose">
    const run = startActiveAgentCliWarmResume({
      terminal,
      sessions,
      getSession: tabId => live.get(tabId),
      onPtyCreated() {},
      concurrency: 1,
      attempts: 1,
    })

    await flush()
    assert.deepEqual(started, ["one"])
    run.prioritize("three")
    assert.equal(run.isPending("three"), true)
    gates.get("one")!.resolve({ id: "pty-one" })
    await flush()
    assert.deepEqual(started, ["one", "three"])
    gates.get("three")!.resolve({ id: "pty-three" })
    await flush()
    gates.get("two")!.resolve({ id: "pty-two" })
    await run.done
    assert.deepEqual(started, ["one", "three", "two"])
  })

  it("releases a queued session to the foreground without spawning it", async () => {
    const sessions = [session("one"), session("two")]
    const live = new Map(sessions.map(item => [item.tabId, item]))
    const started: string[] = []
    const gates = new Map<string, ReturnType<typeof deferred<{ id: string }>>>()
    const disposed: string[] = []
    const settled: string[] = []
    const terminal = {
      create(cwdRootUri: string) {
        const tabId = cwdRootUri.slice(cwdRootUri.lastIndexOf("/") + 1)
        started.push(tabId)
        const gate = deferred<{ id: string }>()
        gates.set(tabId, gate)
        return gate.promise
      },
      async dispose(ptyId: string) {
        disposed.push(ptyId)
      },
    } satisfies Pick<JetElectronTerminal, "create" | "dispose">
    const run = startActiveAgentCliWarmResume({
      terminal,
      sessions,
      getSession: tabId => live.get(tabId),
      onPtyCreated(tabId) {
        if (tabId === "two") {
          assert.fail("released session must not bind a warm PTY")
        }
      },
      onJobSettled: tabId => settled.push(tabId),
      concurrency: 1,
      attempts: 1,
    })

    await flush()
    assert.deepEqual(started, ["one"])
    assert.equal(run.isPending("two"), true)
    run.releaseToForeground("two")
    assert.equal(run.isPending("two"), false)
    assert.ok(settled.includes("two"))
    gates.get("one")!.resolve({ id: "pty-one" })
    const summary = await run.done
    assert.deepEqual(started, ["one"])
    assert.equal(summary.skipped, 1)
    assert.equal(summary.resumed, 1)
    assert.deepEqual(disposed, [])
  })

  it("releases an in-flight warm create so the foreground panel can spawn", async () => {
    const active = session("foreground")
    const live = new Map([[active.tabId, active]])
    const gate = deferred<{ id: string }>()
    const disposed: string[] = []
    const settledWakeups: string[] = []
    const terminal = {
      create() {
        return gate.promise
      },
      async dispose(ptyId: string) {
        disposed.push(ptyId)
      },
    } satisfies Pick<JetElectronTerminal, "create" | "dispose">
    const run = startActiveAgentCliWarmResume({
      terminal,
      sessions: [active],
      getSession: tabId => live.get(tabId),
      onPtyCreated() {
        assert.fail("foreground release must dispose the warm PTY")
      },
      onJobSettled: tabId => settledWakeups.push(tabId),
      attempts: 1,
    })

    await flush()
    assert.equal(run.isPending("foreground"), true)
    run.releaseToForeground("foreground")
    assert.equal(run.isPending("foreground"), false)
    assert.equal(settledWakeups[0], "foreground")
    gate.resolve({ id: "warm-pty" })
    const summary = await run.done
    assert.deepEqual(disposed, ["warm-pty"])
    assert.equal(summary.resumed, 0)
    assert.equal(summary.skipped, 1)
    // Wake on release, then again when the abandoned create settles.
    assert.deepEqual(settledWakeups, ["foreground", "foreground"])
  })

  it("isolates failures, retries with backoff, and continues the queue", async () => {
    const sessions = [session("bad"), session("good")]
    const live = new Map(sessions.map(item => [item.tabId, item]))
    const attemptsByTab = new Map<string, number>()
    const delays: number[] = []
    const terminal = {
      async create(cwdRootUri: string) {
        const tabId = cwdRootUri.slice(cwdRootUri.lastIndexOf("/") + 1)
        attemptsByTab.set(tabId, (attemptsByTab.get(tabId) ?? 0) + 1)
        if (tabId === "bad") throw new Error("provider unavailable")
        return { id: "pty-good" }
      },
      async dispose() {},
    } satisfies Pick<JetElectronTerminal, "create" | "dispose">
    const run = startActiveAgentCliWarmResume({
      terminal,
      sessions,
      getSession: tabId => live.get(tabId),
      onPtyCreated() {},
      concurrency: 1,
      attempts: 2,
      retryDelayMs: 75,
      sleep: async delay => {
        delays.push(delay)
      },
    })

    const summary = await run.done
    assert.equal(attemptsByTab.get("bad"), 2)
    assert.equal(attemptsByTab.get("good"), 1)
    assert.deepEqual(delays, [75])
    assert.equal(summary.failed, 1)
    assert.equal(summary.resumed, 1)
  })

  it("disposes an in-flight PTY when the session is archived", async () => {
    const active = session("archive-during-create")
    const live = new Map([[active.tabId, active]])
    const gate = deferred<{ id: string }>()
    const disposed: string[] = []
    const terminal = {
      create() {
        return gate.promise
      },
      async dispose(ptyId: string) {
        disposed.push(ptyId)
      },
    } satisfies Pick<JetElectronTerminal, "create" | "dispose">
    const run = startActiveAgentCliWarmResume({
      terminal,
      sessions: [active],
      getSession: tabId => live.get(tabId),
      onPtyCreated() {
        assert.fail("archived session must not bind a PTY")
      },
      attempts: 1,
    })

    await flush()
    active.archivedAt = "2026-08-01T02:00:00.000Z"
    gate.resolve({ id: "orphan-pty" })
    const summary = await run.done
    assert.deepEqual(disposed, ["orphan-pty"])
    assert.equal(summary.resumed, 0)
    assert.equal(summary.skipped, 1)
  })
})
