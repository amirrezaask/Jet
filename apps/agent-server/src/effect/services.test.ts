import assert from "node:assert/strict"
import { test } from "node:test"
import { Effect } from "effect"
import { makeOrchestrationLive, OrchestrationService, runOrch } from "./services.js"
import type { OrchEventSink } from "../orchestration/engine.js"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

test("Effect OrchestrationService.dispatch create+settle", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gharargah-effect-"))
  const sink: OrchEventSink = {
    threadUpdated: () => undefined,
    threadDelta: () => undefined,
    structuredDelta: () => undefined,
    permissionRequest: () => undefined,
  }
  const layer = makeOrchestrationLive(sink)
  const program = Effect.gen(function* () {
    const orch = yield* OrchestrationService
    const thread = (yield* orch.dispatch({
      type: "thread.create",
      commandId: "cmd-1",
      input: {
        workspaceRootUri: `file://${root}`,
        workspaceRootPath: root,
        agentId: "codex",
        driverId: "codex:app-server",
        title: "effect",
      },
    })) as { id: string }
    assert.ok(thread.id)
    const agents = yield* orch.listAgents()
    assert.ok(agents.agents.some(a => a.id === "codex"))
    yield* orch.close()
    return thread.id
  }).pipe(Effect.provide(layer))

  const id = await Effect.runPromise(program)
  assert.ok(typeof id === "string")
})

test("runOrch surfaces unknown command errors", async () => {
  const sink: OrchEventSink = {
    threadUpdated: () => undefined,
    threadDelta: () => undefined,
    structuredDelta: () => undefined,
    permissionRequest: () => undefined,
  }
  const layer = makeOrchestrationLive(sink)
  const orch = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* OrchestrationService
    }).pipe(Effect.provide(layer)),
  )
  await assert.rejects(() =>
    runOrch(
      orch.dispatch({
        // @ts-expect-error intentional invalid command for error mapping
        type: "not.a.command",
        commandId: "x",
      }),
    ),
  )
  await Effect.runPromise(orch.close())
})
