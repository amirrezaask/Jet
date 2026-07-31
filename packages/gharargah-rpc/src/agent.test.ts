import assert from "node:assert/strict"
import { test } from "node:test"
import { Effect, Schema } from "effect"
import {
  AgentRpcFailure,
  decodeAgentRpcResponse,
  normalizeAgentRpcError,
  agentTransportKindForDriverId,
} from "./agent.js"

test("normalizeAgentRpcError accepts legacy string errors", () => {
  const normalized = normalizeAgentRpcError("turn_already_running")
  assert.equal(normalized._tag, "LegacyAgentRpcError")
  assert.equal(normalized.message, "turn_already_running")
  assert.equal(normalized.retryable, false)
})

test("decodeAgentRpcResponse accepts structured and legacy failure errors", async () => {
  const structured = await Effect.runPromise(
    decodeAgentRpcResponse({
      id: 1,
      error: { _tag: "ThreadNotFoundError", message: "thread not found", retryable: false },
    }),
  )
  assert.ok("error" in structured)
  if ("error" in structured) {
    const tag =
      typeof structured.error === "string" ? structured.error : structured.error._tag
    assert.equal(tag, "ThreadNotFoundError")
  }

  const legacy = await Effect.runPromise(
    decodeAgentRpcResponse({ id: 2, error: "boom" }),
  )
  assert.ok("error" in legacy)
  if ("error" in legacy) {
    assert.equal(normalizeAgentRpcError(legacy.error).message, "boom")
  }

  const success = await Effect.runPromise(
    decodeAgentRpcResponse({ id: 3, result: { ok: true } }),
  )
  assert.ok("result" in success)
})

test("AgentRpcFailure schema decodes legacy string error", async () => {
  const failure = await Effect.runPromise(
    Schema.decodeUnknown(AgentRpcFailure)({ id: 4, error: "x" }),
  )
  assert.equal(failure.error, "x")
})

test("agentTransportKindForDriverId maps driver ids", () => {
  assert.equal(agentTransportKindForDriverId("codex:cli"), "cli")
  assert.equal(agentTransportKindForDriverId("codex:app-server"), "app-server")
  assert.equal(agentTransportKindForDriverId("claude:sdk"), "sdk")
  assert.equal(agentTransportKindForDriverId("cursor:acp"), "acp")
})
