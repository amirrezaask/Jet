import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { lspConnectionMatchesDocument } from "./connection-scope.js"

describe("lspConnectionMatchesDocument", () => {
  it("routes same-language files to only their owning workspace root", () => {
    const languages = ["typescript", "javascript"]
    const rootA = "file:///work/project-a"
    const rootB = "file:///work/project-b"
    const fileA = "file:///work/project-a/src/index.ts"

    assert.equal(
      lspConnectionMatchesDocument(fileA, "typescript", rootA, languages),
      true,
    )
    assert.equal(
      lspConnectionMatchesDocument(fileA, "typescript", rootB, languages),
      false,
    )
  })

  it("does not confuse sibling roots with a shared prefix", () => {
    assert.equal(
      lspConnectionMatchesDocument(
        "file:///work/project-other/src/index.ts",
        "typescript",
        "file:///work/project",
        ["typescript"],
      ),
      false,
    )
  })

  it("excludes untitled and unsupported-language documents", () => {
    assert.equal(
      lspConnectionMatchesDocument(
        "untitled:Untitled-1",
        "typescript",
        "file:///work/project",
        ["typescript"],
      ),
      false,
    )
    assert.equal(
      lspConnectionMatchesDocument(
        "file:///work/project/main.go",
        "go",
        "file:///work/project",
        ["typescript"],
      ),
      false,
    )
  })
})
