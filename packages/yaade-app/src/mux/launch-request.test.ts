import assert from "node:assert/strict"
import { beforeEach, describe, it } from "node:test"
import {
  claimMuxLaunchRequest,
  resetMuxLaunchClaimsForTests,
} from "./launch-request.js"

describe("claimMuxLaunchRequest", () => {
  beforeEach(() => {
    resetMuxLaunchClaimsForTests()
  })

  it("claims each id once across local and module sets", () => {
    const handled = new Set<string>()
    assert.equal(claimMuxLaunchRequest(handled, "launch-1"), true)
    assert.equal(claimMuxLaunchRequest(handled, "launch-1"), false)
    assert.equal(claimMuxLaunchRequest(handled, "launch-2"), true)
    assert.deepEqual([...handled], ["launch-1", "launch-2"])
    // Fresh component ref, same request id — StrictMode remount must not relaunch.
    assert.equal(claimMuxLaunchRequest(new Set(), "launch-1"), false)
  })
})
