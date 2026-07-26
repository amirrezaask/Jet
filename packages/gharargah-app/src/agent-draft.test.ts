import assert from "node:assert/strict"
import test from "node:test"
import {
  createAgentDraftThread,
  isAgentDraftThread,
} from "./agent-draft.js"

test("draft agent threads carry selection but no transport binding", () => {
  const draft = createAgentDraftThread({
    tabId: "gharargah:terminal:one",
    workspaceRootUri: "file:///workspace",
    workspaceRootPath: "/workspace",
    preferredAgentId: "codex",
  })

  assert.equal(draft.agentId, "codex")
  assert.equal(draft.driverId, null)
  assert.equal(draft.model, null)
  assert.equal(draft.messages.length, 0)
  assert.equal(isAgentDraftThread(draft), true)
})

test("persisted agent threads are not drafts", () => {
  assert.equal(
    isAgentDraftThread({
      ...createAgentDraftThread({
        tabId: "one",
        workspaceRootUri: "file:///workspace",
        workspaceRootPath: "/workspace",
      }),
      id: "thread-1",
    }),
    false,
  )
})
