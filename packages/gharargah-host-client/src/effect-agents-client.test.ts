import assert from "node:assert/strict"
import { test } from "node:test"
import { Effect } from "effect"
import { decodeAgentPushPayload } from "@gharargah/rpc"
import { agentRpcClientErrorFromWire } from "./agent-rpc-client-error.js"

test("agentRpcClientErrorFromWire preserves tag and retryable", () => {
  const err = agentRpcClientErrorFromWire({
    _tag: "HostDisconnected",
    message: "socket down",
    retryable: true,
  })
  assert.equal(err.tag, "HostDisconnected")
  assert.equal(err.message, "socket down")
  assert.equal(err.retryable, true)
  assert.ok(err instanceof Error)
})

test("malformed push payload decode returns left", () => {
  const result = Effect.runSync(
    decodeAgentPushPayload("agents:threadDelta", { bad: true }).pipe(Effect.either),
  )
  assert.equal(result._tag, "Left")
})

test("valid thread delta push payload decodes", () => {
  const result = Effect.runSync(
    decodeAgentPushPayload("agents:threadDelta", {
      workspaceRootUri: "file:///tmp",
      threadId: "t1",
      updatedAt: "2026-01-01T00:00:00.000Z",
      status: "running",
      lastError: null,
      messageId: "m1",
      text: "hi",
      streaming: true,
    }).pipe(Effect.either),
  )
  assert.equal(result._tag, "Right")
})
