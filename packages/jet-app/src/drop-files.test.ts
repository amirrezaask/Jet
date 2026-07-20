import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  formatPathsForTerminal,
  shellQuotePath,
} from "./drop-files.js"

describe("drop-files", () => {
  it("shellQuotePath leaves simple paths unquoted", () => {
    assert.equal(shellQuotePath("/tmp/foo.ts"), "/tmp/foo.ts")
  })

  it("shellQuotePath wraps paths with spaces", () => {
    assert.equal(shellQuotePath("/tmp/my file.ts"), "'/tmp/my file.ts'")
  })

  it("shellQuotePath escapes embedded single quotes", () => {
    assert.equal(shellQuotePath("/tmp/it's.ts"), `'/tmp/it'"'"'s.ts'`)
  })

  it("formatPathsForTerminal joins multiple paths", () => {
    assert.equal(formatPathsForTerminal(["/a.ts", "/b dir/c.ts"]), "/a.ts '/b dir/c.ts'")
  })
})
