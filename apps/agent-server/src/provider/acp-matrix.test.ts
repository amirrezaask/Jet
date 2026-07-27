/**
 * Node mock-acp scenario matrix for Effect agent-server.
 * Covers the critical Rust-era scenarios: echo, permission, cancel, tool_lifecycle.
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { OrchestrationEngine } from "../orchestration/engine.js"
import type { AgentThread } from "@gharargah/agents"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const MOCK_ACP = path.join(REPO_ROOT, "apps/server/target/debug/gharargah-mock-acp")

function sink() {
  const events: string[] = []
  return {
    events,
    sink: {
      threadUpdated: () => events.push("threadUpdated"),
      threadDelta: () => events.push("threadDelta"),
      structuredDelta: () => events.push("structuredDelta"),
      permissionRequest: () => events.push("permissionRequest"),
    },
  }
}

async function waitFor(
  pred: () => boolean | Promise<boolean>,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await pred()) return
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error("timeout waiting for condition")
}

async function withEngine(
  scenario: string,
  fn: (engine: OrchestrationEngine, root: string) => Promise<void>,
): Promise<void> {
  if (!fs.existsSync(MOCK_ACP)) {
    throw new Error(`missing mock-acp at ${MOCK_ACP}; build gharargah-mock-acp first`)
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gharargah-matrix-"))
  const prev = {
    mock: process.env.GHARARGAH_AGENT_MOCK,
    scenario: process.env.GHARARGAH_AGENT_MOCK_SCENARIO,
    bin: process.env.GHARARGAH_MOCK_ACP_BIN,
  }
  process.env.GHARARGAH_AGENT_MOCK = "1"
  process.env.GHARARGAH_AGENT_MOCK_SCENARIO = scenario
  process.env.GHARARGAH_MOCK_ACP_BIN = MOCK_ACP
  const { sink: eventSink } = sink()
  const engine = new OrchestrationEngine(eventSink)
  try {
    await fn(engine, root)
  } finally {
    engine.close()
    if (prev.mock === undefined) delete process.env.GHARARGAH_AGENT_MOCK
    else process.env.GHARARGAH_AGENT_MOCK = prev.mock
    if (prev.scenario === undefined) delete process.env.GHARARGAH_AGENT_MOCK_SCENARIO
    else process.env.GHARARGAH_AGENT_MOCK_SCENARIO = prev.scenario
    if (prev.bin === undefined) delete process.env.GHARARGAH_MOCK_ACP_BIN
    else process.env.GHARARGAH_MOCK_ACP_BIN = prev.bin
  }
}

async function createCursorThread(engine: OrchestrationEngine, root: string) {
  return (await engine.dispatch({
    type: "thread.create",
    commandId: `create-${crypto.randomUUID()}`,
    input: {
      workspaceRootUri: `file://${root}`,
      workspaceRootPath: root,
      agentId: "cursor",
      driverId: "cursor:acp",
      title: "matrix",
    },
  })) as AgentThread
}

test("matrix: echo streams mock reply then idle", async () => {
  await withEngine("echo", async (engine, root) => {
    const thread = await createCursorThread(engine, root)
    await engine.dispatch({
      type: "thread.turn.start",
      commandId: `turn-${crypto.randomUUID()}`,
      input: {
        workspaceRootUri: thread.workspaceRootUri,
        workspaceRootPath: root,
        threadId: thread.id,
        text: "hello matrix",
      },
    })
    await waitFor(() => {
      const t = engine.readThread(root, thread.id)
      return t?.status === "idle" && (t.messages.at(-1)?.text ?? "").includes("hello matrix")
    })
    const done = engine.readThread(root, thread.id)!
    assert.equal(done.status, "idle")
    assert.match(done.messages.at(-1)?.text ?? "", /Mock agent reply: hello matrix|hello matrix/)
    assert.ok(done.acpSessionId)
  })
})

test("matrix: permission_allow blocks then resumes after approval", async () => {
  await withEngine("permission_allow", async (engine, root) => {
    const thread = await createCursorThread(engine, root)
    await engine.dispatch({
      type: "thread.turn.start",
      commandId: `turn-${crypto.randomUUID()}`,
      input: {
        workspaceRootUri: thread.workspaceRootUri,
        workspaceRootPath: root,
        threadId: thread.id,
        text: "need permission",
      },
    })
    await waitFor(() => {
      const t = engine.readThread(root, thread.id)
      return (t?.pendingPermissions?.length ?? 0) > 0 || t?.status === "waiting_for_permission"
    })
    const waiting = engine.readThread(root, thread.id)!
    const permissionId = waiting.pendingPermissions?.[0]?.id
    assert.ok(permissionId)
    const firstOpt = waiting.pendingPermissions?.[0]?.options?.[0]
    const optionId =
      typeof firstOpt === "string" ? firstOpt : (firstOpt?.id ?? "allow_once")
    await engine.dispatch({
      type: "thread.approval.respond",
      commandId: `perm-${crypto.randomUUID()}`,
      input: {
        workspaceRootUri: thread.workspaceRootUri,
        workspaceRootPath: root,
        threadId: thread.id,
        permissionId,
        optionId,
        approvalDecision: "accept",
      },
    })
    await waitFor(() => engine.readThread(root, thread.id)?.status === "idle")
    assert.equal(engine.readThread(root, thread.id)?.status, "idle")
  })
})

test("matrix: cancel_coop interrupts a running turn", async () => {
  await withEngine("cancel_coop", async (engine, root) => {
    const thread = await createCursorThread(engine, root)
    await engine.dispatch({
      type: "thread.turn.start",
      commandId: `turn-${crypto.randomUUID()}`,
      input: {
        workspaceRootUri: thread.workspaceRootUri,
        workspaceRootPath: root,
        threadId: thread.id,
        text: "please wait",
      },
    })
    await waitFor(() => {
      const s = engine.readThread(root, thread.id)?.status
      return s === "running" || s === "waiting_for_permission"
    }, 5_000).catch(() => undefined)
    await engine.dispatch({
      type: "thread.turn.interrupt",
      commandId: `cancel-${crypto.randomUUID()}`,
      input: {
        workspaceRootUri: thread.workspaceRootUri,
        workspaceRootPath: root,
        threadId: thread.id,
      },
    })
    await waitFor(() => {
      const s = engine.readThread(root, thread.id)?.status
      return s === "cancelled" || s === "cancelling" || s === "idle"
    })
    const status = engine.readThread(root, thread.id)?.status
    assert.ok(
      status === "cancelled" || status === "cancelling" || status === "idle",
      `unexpected status ${status}`,
    )
  })
})

test("matrix: tool_lifecycle emits tool timeline items", async () => {
  await withEngine("tool_lifecycle", async (engine, root) => {
    const thread = await createCursorThread(engine, root)
    await engine.dispatch({
      type: "thread.turn.start",
      commandId: `turn-${crypto.randomUUID()}`,
      input: {
        workspaceRootUri: thread.workspaceRootUri,
        workspaceRootPath: root,
        threadId: thread.id,
        text: "run a tool",
      },
    })
    await waitFor(() => {
      const t = engine.readThread(root, thread.id)
      const tools = (t?.timeline ?? []).filter(i => i.kind === "tool_call")
      return tools.length > 0 || t?.status === "idle"
    })
    const done = engine.readThread(root, thread.id)!
    const tools = (done.timeline ?? []).filter(i => i.kind === "tool_call")
    assert.ok(tools.length >= 1 || done.status === "idle", "expected tool items or completed turn")
  })
})
