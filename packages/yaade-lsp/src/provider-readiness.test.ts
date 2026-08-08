import assert from "node:assert/strict"
import { test } from "node:test"

import { isDocumentOpenForConnection } from "./provider-readiness.js"

test("providers stay dormant for scoped models until didOpen ownership exists", () => {
  const uri = "file:///workspace/large.ts"
  assert.equal(isDocumentOpenForConnection(uri, undefined), false)
  assert.equal(isDocumentOpenForConnection(uri, new Set()), false)
  assert.equal(isDocumentOpenForConnection(uri, new Set(["file:///workspace/other.ts"])), false)
  assert.equal(isDocumentOpenForConnection(uri, new Set([uri])), true)
})
