import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { HqAgentSummary } from "@yaade/rpc"
import { filterHqAgents, isAccessibleHqAgent, sortHqAgents } from "./hq-model.js"

function agent(
  sessionId: string,
  overrides: Partial<HqAgentSummary> = {},
): HqAgentSummary {
  return HqAgentSummary.make({
    sessionId,
    ptyId: `pty-${sessionId}`,
    projectId: "project-1",
    projectName: "yaade",
    projectPath: "/dev/yaade",
    projectSessionId: "session-1",
    projectSessionTitle: "Main",
    cwdPath: "/dev/yaade",
    worktreeBranch: null,
    provider: "codex",
    title: sessionId,
    status: "idle",
    activity: "Idle",
    telemetry: "connected",
    startedAt: null,
    lastActivityAt: "2026-08-01T00:00:00.000Z",
    runtimeMs: 1,
    unreadCount: 0,
    attention: null,
    currentTool: null,
    ...overrides,
  })
}

describe("HQ agent workload model", () => {
  it("sorts attention, unread, work, start, then idle stably", () => {
    const sorted = sortHqAgents([
      agent("idle-a"),
      agent("working", { status: "working" }),
      agent("attention", { attention: "waiting_for_user" }),
      agent("unread", { unreadCount: 2 }),
      agent("starting", { status: "starting" }),
      agent("idle-b"),
    ])
    assert.deepEqual(
      sorted.map(item => item.sessionId),
      ["attention", "unread", "working", "starting", "idle-a", "idle-b"],
    )
  })

  it("filters by project, attention, and row-only search content", () => {
    const rows = [
      agent("a", { title: "Fix persistence", attention: "permission_required" }),
      agent("b", { projectId: "project-2", projectName: "console" }),
    ]
    assert.deepEqual(
      filterHqAgents(rows, { query: "persistence", projectId: "", filter: "all" }).map(
        item => item.sessionId,
      ),
      ["a"],
    )
    assert.deepEqual(
      filterHqAgents(rows, { query: "", projectId: "", filter: "attention" }).map(
        item => item.sessionId,
      ),
      ["a"],
    )
    assert.deepEqual(
      filterHqAgents(rows, { query: "", projectId: "project-2", filter: "all" }).map(
        item => item.sessionId,
      ),
      ["b"],
    )
  })

  it("hides agents whose process is no longer accessible", () => {
    assert.equal(isAccessibleHqAgent(agent("live")), true)
    assert.equal(isAccessibleHqAgent(agent("done", { status: "completed" })), false)
    assert.equal(isAccessibleHqAgent(agent("dead", { status: "terminated" })), false)
    assert.equal(isAccessibleHqAgent(agent("fail", { status: "failed" })), false)
    assert.equal(
      isAccessibleHqAgent(agent("gone", { status: "disconnected" })),
      false,
    )
    assert.deepEqual(
      filterHqAgents(
        [
          agent("live", { status: "idle" }),
          agent("done", { status: "completed" }),
        ],
        { query: "", projectId: "", filter: "all" },
      ).map(item => item.sessionId),
      ["live"],
    )
  })
})
