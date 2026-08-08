import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  clearHqAgentLaunch,
  peekHqAgentLaunch,
  queueHqAgentLaunch,
} from "./hq-agent-launch.js"

describe("hq-agent-launch", () => {
  it("queues, peeks by project, and clears", () => {
    clearHqAgentLaunch()
    queueHqAgentLaunch({
      id: "hq-1",
      projectId: "proj-a",
      driverId: "cursor",
    })
    assert.equal(peekHqAgentLaunch("proj-b"), null)
    assert.deepEqual(peekHqAgentLaunch("proj-a"), {
      id: "hq-1",
      projectId: "proj-a",
      driverId: "cursor",
    })
    clearHqAgentLaunch("other")
    assert.ok(peekHqAgentLaunch("proj-a"))
    clearHqAgentLaunch("hq-1")
    assert.equal(peekHqAgentLaunch("proj-a"), null)
  })
})
