import assert from "node:assert/strict"
import test from "node:test"
import type { CodeAction } from "vscode-languageserver-protocol"
import { atomicResourceEditCommand } from "./workspace-edit-policy.js"

test("resource-bearing code actions route through the atomic client command", () => {
  const edit: CodeAction["edit"] = {
    documentChanges: [
      {
        kind: "rename",
        oldUri: "file:///repo/old.ts",
        newUri: "file:///repo/new.ts",
      },
    ],
  }
  const mapped = atomicResourceEditCommand(
    edit,
    undefined,
    "yaade.lsp.atomic-resource-edit",
    "Rename resource",
  )

  assert.equal(mapped?.id, "yaade.lsp.atomic-resource-edit")
  assert.deepEqual(mapped?.arguments, [edit, undefined])
})
