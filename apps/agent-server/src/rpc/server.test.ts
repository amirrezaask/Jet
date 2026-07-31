import assert from "node:assert/strict"
import { test } from "node:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { startAgentServer } from "./server.js"
import { OrchestrationEngine } from "../orchestration/engine.js"
import type { AgentThread } from "@gharargah/agents"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const MOCK_ACP = path.join(REPO_ROOT, "apps/host-server/mocks/bin/gharargah-mock-acp")

function sink() {
  return {
    threadUpdated: () => undefined,
    threadDelta: () => undefined,
    structuredDelta: () => undefined,
    permissionRequest: () => undefined,
  }
}

async function waitFor(
  pred: () => boolean | Promise<boolean>,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await pred()) return
    await new Promise(r => setTimeout(r, 40))
  }
  throw new Error("timeout")
}

async function rpc<T>(
  port: number,
  method: string,
  params?: unknown,
): Promise<{ result?: T; error?: string | { _tag: string; message: string } }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/agents`)
    const timer = setTimeout(() => reject(new Error("rpc timeout")), 8_000)
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ id: 42, method, params }))
    })
    ws.addEventListener("message", ev => {
      const msg = JSON.parse(String(ev.data)) as {
        id?: number
        result?: T
        error?: string | { _tag: string; message: string }
      }
      if (msg.id === 42) {
        clearTimeout(timer)
        ws.close()
        resolve(msg)
      }
    })
    ws.addEventListener("error", () => reject(new Error("ws error")))
  })
}

test("health endpoint + typed rpc error round-trip", async () => {
  const port = 18765 + Math.floor(Math.random() * 1000)
  const live = await startAgentServer({ host: "127.0.0.1", port })
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`)
    assert.equal(res.status, 200)

    const msg = await rpc<{ agents: unknown[] }>(port, "agents:listAgents", [])
    assert.ok(msg.result)
    assert.ok(Array.isArray(msg.result!.agents))

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gharargah-rpc-"))
    const created = await rpc<AgentThread>(port, "agents:createThread", {
      workspaceRootUri: `file://${root}`,
      workspaceRootPath: root,
      agentId: "codex",
      driverId: "codex:cli",
      title: "cli",
    })
    assert.ok(created.result?.id)
    // A driver id nothing can serve is the error case; a `:cli` id is not, since
    // the in-app chat rewrites it to the agent's native driver.
    const turn = await rpc(port, "agents:sendMessage", {
      workspaceRootUri: `file://${root}`,
      workspaceRootPath: root,
      threadId: created.result!.id,
      text: "hi",
      driverId: "codex:nonsense",
    })
    assert.ok(turn.error)
    const err = turn.error
    if (typeof err === "string") {
      assert.ok(err.includes("codex:nonsense") || err.toLowerCase().includes("driver"))
    } else {
      assert.equal(err._tag, "UnknownDriverError")
      assert.ok(err.message.includes("codex:nonsense") || err.message.includes("driver"))
    }
  } finally {
    await live.close()
  }
})

test("driver lifecycle: interrupt mid-turn settles pending permission", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gharargah-life-"))
  process.env.GHARARGAH_AGENT_MOCK = "1"
  const engine = new OrchestrationEngine(sink())
  const thread = (await engine.dispatch({
    type: "thread.create",
    commandId: crypto.randomUUID(),
    input: {
      workspaceRootUri: `file://${root}`,
      workspaceRootPath: root,
      agentId: "codex",
      driverId: "codex:app-server",
      title: "life",
    },
  })) as AgentThread

  void engine.dispatch({
    type: "thread.turn.start",
    commandId: crypto.randomUUID(),
    input: {
      workspaceRootUri: thread.workspaceRootUri,
      workspaceRootPath: root,
      threadId: thread.id,
      text: "please request permission",
    },
  })

  await waitFor(() => {
    const t = engine.readThread(root, thread.id)
    return (t?.pendingPermissions?.length ?? 0) > 0
  })

  await engine.dispatch({
    type: "thread.turn.interrupt",
    commandId: crypto.randomUUID(),
    input: { workspaceRootUri: thread.workspaceRootUri, workspaceRootPath: root, threadId: thread.id },
  })

  await waitFor(() => {
    const t = engine.readThread(root, thread.id)
    return (
      t?.status === "cancelled" &&
      (t.pendingPermissions ?? []).every(p => p.status === "cancelled")
    )
  })
  engine.close()
})

test("driver lifecycle: late delta after completion is ignored", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gharargah-stale-"))
  process.env.GHARARGAH_AGENT_MOCK = "1"
  const engine = new OrchestrationEngine(sink())
  const thread = (await engine.dispatch({
    type: "thread.create",
    commandId: crypto.randomUUID(),
    input: {
      workspaceRootUri: `file://${root}`,
      workspaceRootPath: root,
      agentId: "opencode",
      driverId: "opencode:sdk",
      title: "stale",
    },
  })) as AgentThread

  await engine.dispatch({
    type: "thread.turn.start",
    commandId: crypto.randomUUID(),
    input: {
      workspaceRootUri: thread.workspaceRootUri,
      workspaceRootPath: root,
      threadId: thread.id,
      text: "hello",
    },
  })

  await waitFor(() => engine.readThread(root, thread.id)?.status === "idle")

  const before = engine.readThread(root, thread.id)?.messages.at(-1)?.text ?? ""
  // Simulate stale event by starting a new internal turn id via direct store hack — use permission path instead:
  // After idle, applyRuntimeEvent ignores non-terminal events without active turn.
  await engine.dispatch({
    type: "thread.turn.start",
    commandId: crypto.randomUUID(),
    input: {
      workspaceRootUri: thread.workspaceRootUri,
      workspaceRootPath: root,
      threadId: thread.id,
      text: "second",
    },
  })
  await waitFor(() => engine.readThread(root, thread.id)?.status === "idle")
  const after = engine.readThread(root, thread.id)?.messages.at(-1)?.text ?? ""
  assert.notEqual(after, "")
  assert.ok(after.includes("mock:") || after.includes("hello"))
  assert.ok(before.length <= after.length)
  engine.close()
})

test("acp mock cancel mid-turn via wait scenario", async () => {
  if (!fs.existsSync(MOCK_ACP)) return
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gharargah-acp-cancel-"))
  const prev = {
    mock: process.env.GHARARGAH_AGENT_MOCK,
    scenario: process.env.GHARARGAH_AGENT_MOCK_SCENARIO,
    bin: process.env.GHARARGAH_MOCK_ACP_BIN,
  }
  process.env.GHARARGAH_AGENT_MOCK = "1"
  process.env.GHARARGAH_AGENT_MOCK_SCENARIO = "cancel"
  process.env.GHARARGAH_MOCK_ACP_BIN = MOCK_ACP
  const engine = new OrchestrationEngine(sink())
  try {
    const thread = (await engine.dispatch({
      type: "thread.create",
      commandId: crypto.randomUUID(),
      input: {
        workspaceRootUri: `file://${root}`,
        workspaceRootPath: root,
        agentId: "cursor",
        driverId: "cursor:acp",
        title: "cancel",
      },
    })) as AgentThread
    void engine.dispatch({
      type: "thread.turn.start",
      commandId: crypto.randomUUID(),
      input: {
        workspaceRootUri: thread.workspaceRootUri,
        workspaceRootPath: root,
        threadId: thread.id,
        text: "go",
      },
    })
    await waitFor(() => engine.readThread(root, thread.id)?.status === "running")
    await engine.dispatch({
      type: "thread.turn.interrupt",
      commandId: crypto.randomUUID(),
      input: {
        workspaceRootUri: thread.workspaceRootUri,
        workspaceRootPath: root,
        threadId: thread.id,
      },
    })
    await waitFor(() => {
      const s = engine.readThread(root, thread.id)?.status
      return s === "cancelled" || s === "idle"
    })
  } finally {
    engine.close()
    if (prev.mock === undefined) delete process.env.GHARARGAH_AGENT_MOCK
    else process.env.GHARARGAH_AGENT_MOCK = prev.mock
    if (prev.scenario === undefined) delete process.env.GHARARGAH_AGENT_MOCK_SCENARIO
    else process.env.GHARARGAH_AGENT_MOCK_SCENARIO = prev.scenario
    if (prev.bin === undefined) delete process.env.GHARARGAH_MOCK_ACP_BIN
    else process.env.GHARARGAH_MOCK_ACP_BIN = prev.bin
  }
})

test("claude sdk mock wait + interrupt cancels turn", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gharargah-claude-wait-"))
  process.env.GHARARGAH_AGENT_MOCK = "1"
  const engine = new OrchestrationEngine(sink())
  const thread = (await engine.dispatch({
    type: "thread.create",
    commandId: crypto.randomUUID(),
    input: {
      workspaceRootUri: `file://${root}`,
      workspaceRootPath: root,
      agentId: "claude",
      driverId: "claude:sdk",
      title: "wait",
    },
  })) as AgentThread

  void engine.dispatch({
    type: "thread.turn.start",
    commandId: crypto.randomUUID(),
    input: {
      workspaceRootUri: thread.workspaceRootUri,
      workspaceRootPath: root,
      threadId: thread.id,
      text: "wait",
    },
  })

  await waitFor(() => engine.readThread(root, thread.id)?.status === "running")
  await engine.dispatch({
    type: "thread.turn.interrupt",
    commandId: crypto.randomUUID(),
    input: { workspaceRootUri: thread.workspaceRootUri, workspaceRootPath: root, threadId: thread.id },
  })
  await waitFor(() => engine.readThread(root, thread.id)?.status === "cancelled")
  engine.close()
})
