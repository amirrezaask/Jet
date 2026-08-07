import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { claimMuxLaunchRequest } from "./launch-request.js"

describe("claimMuxLaunchRequest", () => {
  it("claims each request id exactly once", () => {
    const handled = new Set<string>()
    assert.equal(claimMuxLaunchRequest(handled, "launch-1"), true)
    assert.equal(claimMuxLaunchRequest(handled, "launch-1"), false)
    assert.equal(claimMuxLaunchRequest(handled, "launch-2"), true)
    assert.deepEqual([...handled], ["launch-1", "launch-2"])
  })
})
