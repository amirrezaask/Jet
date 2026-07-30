import assert from "node:assert/strict"
import { describe, it, beforeEach } from "node:test"
import {
  buildAgentCliLaunchArgs,
  extractAgentCliSessionIdFromLaunchArgs,
  isPersistableAgentSession,
  launchArgsIncludeResume,
  mergeAgentCliResumeArgs,
  prepareHydratedAgentCliFields,
  tryParseAgentCliSessionId,
} from "./agent-cli-launch.js"
import {
  applyAgentCliResumeLaunchArgs,
  ensureAgentCliProcess,
} from "./agent-cli-resume.js"
import {
  clearTerminalSession,
  hydrateTerminalSession,
  listTerminalSessions,
  markSessionDone,
  sessionHasResumableAgentCli,
  setAgentCliSessionId,
  terminalSessionForTab,
} from "./tabs/terminal-session.js"

const context = {
  sessionId: "gharargah:terminal:test",
  origin: "http://127.0.0.1:4747",
}

const UUID = "11111111-1111-4111-8111-111111111111"

describe("agentCliLaunch resume argv", () => {
  it("codex: resume <id> before notify", () => {
    const resumed = buildAgentCliLaunchArgs("codex", context, UUID)
    assert.deepEqual(resumed.slice(0, 2), ["resume", UUID])
    assert.ok(resumed.at(-1)?.startsWith("notify="))
  })

  it("claude: --resume <id>", () => {
    assert.deepEqual(
      mergeAgentCliResumeArgs("claude", ["--settings", "{}"], UUID).slice(0, 2),
      ["--resume", UUID],
    )
  })

  it("cursor: --resume=<id> --trust", () => {
    assert.deepEqual(buildAgentCliLaunchArgs("cursor", context, UUID), [
      `--resume=${UUID}`,
      "--trust",
    ])
  })

  it("opencode: --session <id>", () => {
    assert.deepEqual(
      mergeAgentCliResumeArgs("opencode", [], "ses_abc123").slice(0, 2),
      ["--session", "ses_abc123"],
    )
  })

  it("grok: --resume <id>", () => {
    assert.deepEqual(mergeAgentCliResumeArgs("grok", [], UUID).slice(0, 2), [
      "--resume",
      UUID,
    ])
  })

  it("parses provider session ids from output", () => {
    assert.equal(
      tryParseAgentCliSessionId("claude", `Session started session_id=${UUID}`),
      UUID,
    )
    assert.equal(
      tryParseAgentCliSessionId(
        "opencode",
        "Continuing session ses_3cf7dd8d4ffeUPfENpVxfFojZ2",
      ),
      "ses_3cf7dd8d4ffeUPfENpVxfFojZ2",
    )
    assert.equal(
      tryParseAgentCliSessionId(
        "codex",
        `thread-id=${UUID} agent turn complete`,
      ),
      UUID,
    )
    assert.equal(
      tryParseAgentCliSessionId(
        "cursor",
        `{"type":"system","session_id":"${UUID}","model":"x"}`,
      ),
      UUID,
    )
    assert.equal(
      tryParseAgentCliSessionId("cursor", `noise ${UUID} more`),
      null,
    )
    assert.equal(tryParseAgentCliSessionId("codex", "noise only"), null)
  })

  it("extracts cli session id from resume launchArgs", () => {
    assert.equal(
      extractAgentCliSessionIdFromLaunchArgs("cursor", [
        `--resume=${UUID}`,
        "--trust",
      ]),
      UUID,
    )
    assert.equal(
      extractAgentCliSessionIdFromLaunchArgs("codex", ["resume", UUID, "-c", "x"]),
      UUID,
    )
    assert.equal(
      extractAgentCliSessionIdFromLaunchArgs("opencode", ["--session", "ses_abc"]),
      "ses_abc",
    )
    assert.equal(
      extractAgentCliSessionIdFromLaunchArgs("claude", ["--resume", UUID]),
      UUID,
    )
    assert.equal(extractAgentCliSessionIdFromLaunchArgs("cursor", ["--trust"]), null)
  })

  it("hydrate rebuilds resume argv when agentCliSessionId present", () => {
    const fields = prepareHydratedAgentCliFields({
      tabId: "gharargah:terminal:x",
      agentId: "codex",
      agentCliSessionId: UUID,
      launchCommand: "codex",
      status: "running",
      origin: context.origin,
    })
    assert.equal(fields.status, "starting")
    assert.equal(fields.ptyId, undefined)
    assert.equal(fields.agentCliSessionId, UUID)
    assert.ok(launchArgsIncludeResume("codex", fields.launchArgs, UUID))
  })

  it("hydrate recovers cli session id from launchArgs when column missing", () => {
    const fields = prepareHydratedAgentCliFields({
      tabId: "gharargah:terminal:cursor-race",
      agentId: "cursor",
      launchCommand: "cursor-agent",
      launchArgs: [`--resume=${UUID}`, "--trust"],
      status: "running",
      origin: context.origin,
    })
    assert.equal(fields.agentCliSessionId, UUID)
    assert.equal(fields.status, "starting")
    assert.ok(launchArgsIncludeResume("cursor", fields.launchArgs, UUID))
  })

  it("persists top-level sessions; skips child shells and incomplete agents", () => {
    assert.equal(
      isPersistableAgentSession({
        agentId: "codex",
        launchCommand: "codex",
      }),
      true,
    )
    assert.equal(isPersistableAgentSession({}), true)
    assert.equal(isPersistableAgentSession({ agentId: "codex" }), false)
  })
})

describe("ensureAgentCliProcess", () => {
  beforeEach(() => {
    for (const session of listTerminalSessions()) {
      clearTerminalSession(session.tabId)
    }
  })

  it("respawns exited agent with resume argv", () => {
    const tabId = "gharargah:terminal:resume-exit"
    hydrateTerminalSession({
      tabId,
      cwdRootUri: "file:///tmp/proj",
      launchCommand: "codex",
      launchArgs: ["-c", "notify=x"],
      status: "exited",
      exitCode: 0,
      agentId: "codex",
      agentCliSessionId: UUID,
    })

    assert.equal(ensureAgentCliProcess(tabId), true)
    const session = terminalSessionForTab(tabId)
    assert.ok(session)
    assert.equal(session.status, "starting")
    assert.ok(launchArgsIncludeResume("codex", session.launchArgs, UUID))
    assert.ok(session.generation >= 1)
  })

  it("no-ops while first spawn is still starting without pty", () => {
    const tabId = "gharargah:terminal:fresh"
    hydrateTerminalSession({
      tabId,
      cwdRootUri: "file:///tmp/proj",
      launchCommand: "claude",
      status: "starting",
      agentId: "claude",
    })
    const gen = terminalSessionForTab(tabId)?.generation ?? 0
    assert.equal(ensureAgentCliProcess(tabId), false)
    assert.equal(terminalSessionForTab(tabId)?.generation, gen)
  })

  it("skips done sessions", () => {
    const tabId = "gharargah:terminal:done"
    hydrateTerminalSession({
      tabId,
      cwdRootUri: "file:///tmp/proj",
      launchCommand: "codex",
      status: "exited",
      agentId: "codex",
      agentCliSessionId: UUID,
    })
    markSessionDone(tabId)
    assert.equal(ensureAgentCliProcess(tabId), false)
  })

  it("applyAgentCliResumeLaunchArgs writes opencode --session", () => {
    const tabId = "gharargah:terminal:oc"
    hydrateTerminalSession({
      tabId,
      cwdRootUri: "file:///tmp/proj",
      launchCommand: "opencode",
      status: "running",
      agentId: "opencode",
    })
    setAgentCliSessionId(tabId, "ses_abc")
    assert.equal(applyAgentCliResumeLaunchArgs(tabId), true)
    assert.ok(
      launchArgsIncludeResume(
        "opencode",
        terminalSessionForTab(tabId)?.launchArgs,
        "ses_abc",
      ),
    )
  })

  it("sessionHasResumableAgentCli treats resume launchArgs as resumable", () => {
    const tabId = "gharargah:terminal:args-only"
    hydrateTerminalSession({
      tabId,
      cwdRootUri: "file:///tmp/proj",
      launchCommand: "cursor-agent",
      launchArgs: [`--resume=${UUID}`, "--trust"],
      status: "starting",
      agentId: "cursor",
    })
    assert.equal(sessionHasResumableAgentCli(tabId), true)
  })
})
