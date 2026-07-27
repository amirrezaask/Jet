import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { isPathUnderRoot, resolvePathUnderRoot } from "./path-utils.js"

describe("code-editor-service paths", () => {
  it("resolves relative paths under root", () => {
    assert.equal(
      resolvePathUnderRoot("/proj", "src/index.ts"),
      "/proj/src/index.ts",
    )
    assert.equal(
      resolvePathUnderRoot("/proj/", "./src/a.ts"),
      "/proj/src/a.ts",
    )
  })

  it("keeps absolute and file:// paths", () => {
    assert.equal(resolvePathUnderRoot("/proj", "/abs/x.ts"), "/abs/x.ts")
    assert.equal(
      resolvePathUnderRoot("/proj", "file:///tmp/x.ts"),
      "/tmp/x.ts",
    )
  })

  it("enforces project boundary", () => {
    assert.equal(isPathUnderRoot("/proj", "/proj/src/a.ts"), true)
    assert.equal(isPathUnderRoot("/proj", "/proj"), true)
    assert.equal(isPathUnderRoot("/proj", "/other/a.ts"), false)
    assert.equal(isPathUnderRoot("/proj", "/proj-evil/a.ts"), false)
  })
})
