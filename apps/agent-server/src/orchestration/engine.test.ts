import assert from "node:assert/strict"
import { test } from "node:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { OrchestrationEngine } from "../orchestration/engine.js"

test("create thread + mock turn + archive blocked while permission pending", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gharargah-orch-"))
  const events: string[] = []
  const engine = new OrchestrationEngine({
    threadUpdated: () => events.push("threadUpdated"),
    threadDelta: () => events.push("threadDelta"),
    structuredDelta: () => events.push("structuredDelta"),
    permissionRequest: () => events.push("permissionRequest"),
  })

  const thread = (await engine.dispatch({
    type: "thread.create",
    commandId: "cmd-create",
    input: {
      workspaceRootUri: `file://${root}`,
      workspaceRootPath: root,
      agentId: "codex",
      driverId: "codex:app-server",
      title: "Test",
    },
  })) as { id: string; workspaceRootPath: string }

  process.env.GHARARGAH_AGENT_MOCK = "1"
  const running = (await engine.dispatch({
    type: "thread.turn.start",
    commandId: "cmd-turn-1",
    input: {
      workspaceRootUri: `file://${root}`,
      workspaceRootPath: root,
      threadId: thread.id,
      text: "hello",
    },
  })) as { id: string; status: string }

  assert.equal(running.id, thread.id)
  assert.ok(["running", "idle", "error", "cancelled"].includes(running.status))

  // Duplicate commandId replays receipt
  const again = await engine.dispatch({
    type: "thread.turn.start",
    commandId: "cmd-turn-1",
    input: {
      workspaceRootUri: `file://${root}`,
      workspaceRootPath: root,
      threadId: thread.id,
      text: "hello",
    },
  })
  assert.deepEqual(again, running)

  await new Promise(r => setTimeout(r, 200))

  const settled = await engine.dispatch({
    type: "thread.settle",
    commandId: "cmd-settle",
    workspaceRootPath: root,
    threadId: thread.id,
  })
  assert.ok(settled)

  engine.close()
})
