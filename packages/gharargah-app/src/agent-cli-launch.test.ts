import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  buildAgentCliLaunchArgs,
  isPersistableAgentSession,
  mergeAgentCliResumeArgs,
  tryParseAgentCliSessionId,
} from "./agent-cli-launch.js"

const context = {
  sessionId: "gharargah:terminal:test",
  origin: "http://127.0.0.1:4747",
}

describe("agentCliLaunch", () => {
  it("prepends codex resume before notify overrides", () => {
    const fresh = buildAgentCliLaunchArgs("codex", context)
    const resumed = buildAgentCliLaunchArgs(
      "codex",
      context,
      "11111111-1111-4111-8111-111111111111",
    )
    assert.deepEqual(resumed.slice(0, 2), [
      "resume",
      "11111111-1111-4111-8111-111111111111",
    ])
    assert.ok(resumed.length > fresh.length)
    assert.ok(resumed.at(-1)?.startsWith("notify="))
  })

  it("launches cursor-agent with --trust and keeps it on resume", () => {
    const fresh = buildAgentCliLaunchArgs("cursor", context)
    assert.deepEqual(fresh, ["--trust"])
    const resumed = buildAgentCliLaunchArgs(
      "cursor",
      context,
      "44444444-4444-4444-8444-444444444444",
    )
    assert.deepEqual(resumed, [
      "--resume",
      "44444444-4444-4444-8444-444444444444",
      "--trust",
    ])
  })

  it("prepends claude --resume before settings hook", () => {
    const args = mergeAgentCliResumeArgs(
      "claude",
      ["--settings", "{}"],
      "22222222-2222-4222-8222-222222222222",
    )
    assert.deepEqual(args.slice(0, 2), [
      "--resume",
      "22222222-2222-4222-8222-222222222222",
    ])
  })

  it("parses session ids from provider output", () => {
    const id = "33333333-3333-4333-8333-333333333333"
    assert.equal(
      tryParseAgentCliSessionId(
        "claude",
        `Session started session_id=${id}`,
      ),
      id,
    )
    assert.equal(tryParseAgentCliSessionId("codex", "noise only"), null)
  })

  it("only persists agent CLI sessions", () => {
    assert.equal(
      isPersistableAgentSession({
        agentId: "codex",
        launchCommand: "codex",
      }),
      true,
    )
    assert.equal(isPersistableAgentSession({ launchCommand: "codex" }), false)
    assert.equal(
      isPersistableAgentSession({
        agentId: "codex",
        parentSessionTabId: "gharargah:terminal:parent",
      }),
      false,
    )
  })
})
