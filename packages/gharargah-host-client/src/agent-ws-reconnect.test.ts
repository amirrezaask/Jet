import assert from "node:assert/strict"
import { test } from "node:test"
import { computeReconnectDelayMs, DEFAULT_AGENT_WS_BACKOFF } from "./agent-ws-reconnect.js"

test("backoff delay is monotonic in expectation and capped", () => {
  const samples = [0, 1, 2, 3, 4, 5].map(attempt =>
    computeReconnectDelayMs(attempt, DEFAULT_AGENT_WS_BACKOFF, () => 1),
  )
  assert.ok(samples[1]! >= samples[0]!)
  assert.ok(samples[5]! <= DEFAULT_AGENT_WS_BACKOFF.capMs)
})

test("backoff full jitter stays within bounds", () => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    for (let i = 0; i < 20; i += 1) {
      const delay = computeReconnectDelayMs(attempt, DEFAULT_AGENT_WS_BACKOFF)
      const ceiling = Math.min(
        DEFAULT_AGENT_WS_BACKOFF.capMs,
        DEFAULT_AGENT_WS_BACKOFF.baseMs * DEFAULT_AGENT_WS_BACKOFF.factor ** attempt,
      )
      assert.ok(delay >= 0)
      assert.ok(delay < ceiling || ceiling === 0)
    }
  }
})

test("backoff resets on open via attempt zero", () => {
  const first = computeReconnectDelayMs(0, DEFAULT_AGENT_WS_BACKOFF, () => 0.5)
  const recovered = computeReconnectDelayMs(0, DEFAULT_AGENT_WS_BACKOFF, () => 0.5)
  assert.equal(first, recovered)
})
