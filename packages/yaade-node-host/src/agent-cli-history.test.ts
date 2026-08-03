import assert from "node:assert/strict"
import test from "node:test"
import {
  createCodexHistoryHandshake,
  listAgentCliHistory,
  parseCodexThreadListResponse,
  parseGrokSessionList,
  parseOpenCodeSessionList,
  type AgentCliHistoryAdapters,
} from "./agent-cli-history.js"

test("waits for Codex initialize response before thread/list", () => {
  const handshake = createCodexHistoryHandshake(8)
  const start = handshake.start().map(line => JSON.parse(line) as Record<string, unknown>)
  assert.deepEqual(start.map(message => message.method), ["initialize"])

  const ignored = handshake.receive(JSON.stringify({ method: "server/notice" }))
  assert.deepEqual(ignored.outbound, [])

  const initialized = handshake
    .receive(JSON.stringify({ id: 1, result: { serverInfo: { name: "codex" } } }))
    .outbound.map(line => JSON.parse(line) as Record<string, unknown>)
  assert.deepEqual(initialized.map(message => message.method), [
    "initialized",
    "thread/list",
  ])
  assert.equal(initialized[1]?.id, 2)
})

test("parses OpenCode JSON metadata into provider history", () => {
  const sessions = parseOpenCodeSessionList(JSON.stringify([
    {
      id: "ses_external",
      title: "Fix the terminal",
      directory: "/work/jet",
      created: 1_780_000_000_000,
      updated: 1_780_000_010_000,
    },
  ]))

  assert.deepEqual(sessions, [
    {
      id: "ses_external",
      provider: "opencode",
      title: "Fix the terminal",
      cwd: "/work/jet",
      createdAt: "2026-05-28T20:26:40.000Z",
      updatedAt: "2026-05-28T20:26:50.000Z",
    },
  ])
})

test("parses Grok table rows without treating its header as a session", () => {
  const sessions = parseGrokSessionList(
    [
      "SESSION ID                            CREATED     UPDATED     STATUS      SUMMARY",
      "019f91c2-8e1e-7f41-aa4d-0e891d2b4da7  2026-07-24  2026-07-25  local  Terminal throughput",
    ].join("\n"),
    "/work/jet",
  )

  assert.equal(sessions.length, 1)
  assert.equal(sessions[0]?.title, "Terminal throughput")
  assert.equal(sessions[0]?.cwd, "/work/jet")
  assert.equal(sessions[0]?.updatedAt, "2026-07-25T00:00:00.000Z")
})

test("parses Codex app-server thread/list metadata", () => {
  const sessions = parseCodexThreadListResponse(JSON.stringify({
    id: 2,
    result: {
      data: [
        {
          id: "019fbda5-7b2b-7db0-a068-5663e0425ee4",
          name: "Provider session",
          preview: "fallback preview",
          cwd: "/work/jet",
          createdAt: 1_785_593_166,
          updatedAt: 1_785_595_545,
        },
      ],
    },
  }))

  assert.equal(sessions?.[0]?.provider, "codex")
  assert.equal(sessions?.[0]?.title, "Provider session")
  assert.equal(sessions?.[0]?.cwd, "/work/jet")
  assert.equal(sessions?.[0]?.updatedAt, "2026-08-01T14:45:45.000Z")
})

test("uses the provider's documented noninteractive list command", async () => {
  const calls: Array<{ command: string; args: string[]; cwd: string }> = []
  const adapters: AgentCliHistoryAdapters = {
    async runCommand(command, args, cwd) {
      calls.push({ command, args, cwd })
      return {
        stdout: JSON.stringify([
          {
            id: "ses_external",
            title: "External session",
            directory: cwd,
            created: 1_780_000_000_000,
            updated: 1_780_000_010_000,
          },
        ]),
        stderr: "",
      }
    },
    async listCodex() {
      return []
    },
  }

  const result = await listAgentCliHistory(
    "opencode",
    { cwd: "/work/jet", limit: 8 },
    adapters,
  )

  assert.deepEqual(calls, [
    {
      command: "opencode",
      args: ["session", "list", "--format", "json", "--max-count", "8"],
      cwd: "/work/jet",
    },
  ])
  assert.equal(result.state, "ready")
  assert.equal(result.sessions[0]?.id, "ses_external")
})

test("reports providers whose CLI history is interactive-only", async () => {
  const adapters: AgentCliHistoryAdapters = {
    async runCommand() {
      throw new Error("must not run")
    },
    async listCodex() {
      throw new Error("must not run")
    },
  }

  const claude = await listAgentCliHistory(
    "claude",
    { cwd: "/work/jet" },
    adapters,
  )
  const cursor = await listAgentCliHistory(
    "cursor",
    { cwd: "/work/jet" },
    adapters,
  )

  assert.equal(claude.state, "unsupported")
  assert.match(claude.message, /interactive resume picker/)
  assert.equal(cursor.state, "unsupported")
  assert.match(cursor.message, /raw terminal/)
})
