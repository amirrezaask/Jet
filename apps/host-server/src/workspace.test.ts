import assert from "node:assert/strict"
import { test } from "node:test"

import { EventHub } from "./events.js"
import { mergeWorkspaceFileChangeKind, WorkspaceHost } from "./workspace.js"

test("coalesces watched-file kinds without losing create or delete semantics", () => {
  assert.equal(mergeWorkspaceFileChangeKind(undefined, "created"), "created")
  assert.equal(mergeWorkspaceFileChangeKind("created", "changed"), "created")
  assert.equal(mergeWorkspaceFileChangeKind("changed", "deleted"), "deleted")
  assert.equal(mergeWorkspaceFileChangeKind("deleted", "created"), "changed")
})

test("retains a workspace root until its last client/session owner releases it", () => {
  const workspace = new WorkspaceHost()
  const events = new EventHub()
  const rootUri = "file:///workspace-that-does-not-exist"
  const first = { clientId: "client-one", sessionId: "session-one" }
  const second = { clientId: "client-two", sessionId: "session-two" }

  workspace.activate(events, rootUri, first)
  workspace.activate(events, rootUri, second)
  assert.equal(workspace.activeLeaseCount(rootUri), 2)

  workspace.deactivate(rootUri, first)
  assert.equal(workspace.activeLeaseCount(rootUri), 1)

  workspace.deactivate(rootUri, second)
  assert.equal(workspace.activeLeaseCount(rootUri), 0)
})

test("treats repeated activation and release by the same owner as idempotent", () => {
  const workspace = new WorkspaceHost()
  const events = new EventHub()
  const rootUri = "file:///workspace-that-does-not-exist"
  const owner = { clientId: "client-one", sessionId: "session-one" }

  workspace.activate(events, rootUri, owner)
  workspace.activate(events, rootUri, owner)
  assert.equal(workspace.activeLeaseCount(rootUri), 1)

  workspace.deactivate(rootUri, {
    clientId: "different-client",
    sessionId: owner.sessionId,
  })
  assert.equal(workspace.activeLeaseCount(rootUri), 1)

  workspace.deactivate(rootUri, owner)
  workspace.deactivate(rootUri, owner)
  assert.equal(workspace.activeLeaseCount(rootUri), 0)
})
