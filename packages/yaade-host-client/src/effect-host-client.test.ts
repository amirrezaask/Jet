import assert from "node:assert/strict"
import { test } from "node:test"
import { Effect } from "effect"
import { invokeHostRpc } from "./effect-host-client.js"

test("generic host invokes preserve structured conflict codes", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          code: "CONFLICT",
          message: "restore target already exists",
          details: {},
        },
      }),
      {
        status: 409,
        headers: { "content-type": "application/json" },
      },
    )
  try {
    const error = await Effect.runPromise(
      Effect.flip(invokeHostRpc("test-client", "fs:restoreTrash", ["id"])),
    )
    assert.equal(error.code, "CONFLICT")
  } finally {
    globalThis.fetch = originalFetch
  }
})
