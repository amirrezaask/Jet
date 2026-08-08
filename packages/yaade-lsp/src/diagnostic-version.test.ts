import assert from "node:assert/strict"
import { test } from "node:test"

import { shouldAcceptDiagnostics } from "./diagnostic-version.js"

test("rejects stale versioned diagnostics but accepts current and unversioned diagnostics", () => {
  assert.equal(shouldAcceptDiagnostics(8, 9), false)
  assert.equal(shouldAcceptDiagnostics(9, 9), true)
  assert.equal(shouldAcceptDiagnostics(10, 9), true)
  assert.equal(shouldAcceptDiagnostics(undefined, 9), true)
  assert.equal(shouldAcceptDiagnostics(8, undefined), true)
})
