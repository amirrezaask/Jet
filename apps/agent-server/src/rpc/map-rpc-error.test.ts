import assert from "node:assert/strict"
import { test } from "node:test"
import { mapErrorToAgentRpc } from "./map-rpc-error.js"
import { UnknownDriverError } from "../provider/registry.js"
import { ThreadNotFoundError } from "../effect/errors.js"

test("mapErrorToAgentRpc maps unknown driver without absolute paths", () => {
  const mapped = mapErrorToAgentRpc(
    new UnknownDriverError({
      driverId: "codex:cli",
      message: "Driver codex:cli is catalog-only; open /Users/secret/path instead",
    }),
  )
  assert.equal(mapped._tag, "UnknownDriverError")
  assert.ok(!mapped.message.includes("/Users/secret"))
})

test("mapErrorToAgentRpc maps thread not found", () => {
  const mapped = mapErrorToAgentRpc(new ThreadNotFoundError({ threadId: "abc" }))
  assert.equal(mapped._tag, "ThreadNotFoundError")
  assert.equal(mapped.message, "thread not found")
})
