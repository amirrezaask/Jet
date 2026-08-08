import assert from "node:assert/strict"
import { test } from "node:test"

import {
  resourceOperationUris,
  validateResourceWorkspaceEdit,
  workspaceEditIsEmpty,
} from "./workspace-edit-policy.js"

const edit = {
  documentChanges: [
    { kind: "create" as const, uri: "file:///workspace/new.ts" },
    {
      kind: "rename" as const,
      oldUri: "file:///workspace/old.ts",
      newUri: "file:///workspace/renamed.ts",
    },
    { kind: "delete" as const, uri: "file:///workspace/deleted.ts" },
  ],
}

test("collects every resource-operation URI for atomic preflight", () => {
  assert.deepEqual(resourceOperationUris(edit), [
    "file:///workspace/new.ts",
    "file:///workspace/old.ts",
    "file:///workspace/renamed.ts",
    "file:///workspace/deleted.ts",
  ])
})

test("treats valid no-op workspace edits as successfully applied", () => {
  assert.equal(workspaceEditIsEmpty({}), true)
  assert.equal(workspaceEditIsEmpty({ changes: { "file:///workspace/file.ts": [] } }), true)
  assert.equal(workspaceEditIsEmpty(edit), false)
})

test("rejects path violations and dirty conflicts before mutation", () => {
  const pathViolation = validateResourceWorkspaceEdit(edit, {
    isUriAllowed: uri => !uri.endsWith("new.ts"),
    isDirty: () => false,
  })
  assert.equal(pathViolation.valid, false)
  if (!pathViolation.valid) assert.match(pathViolation.reason, /outside the allowed roots/)
  const dirtyConflict = validateResourceWorkspaceEdit(edit, {
    isUriAllowed: () => true,
    isDirty: uri => uri.endsWith("old.ts"),
  })
  assert.equal(dirtyConflict.valid, false)
  if (!dirtyConflict.valid) assert.match(dirtyConflict.reason, /dirty buffer/)
  assert.deepEqual(validateResourceWorkspaceEdit(edit, {
    isUriAllowed: () => true,
    isDirty: () => false,
  }), { valid: true })
})
