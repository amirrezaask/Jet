import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { resolveLoginShellPath } from "./shell-env.js"

describe("shell-env", () => {
  it("resolveLoginShellPath returns non-empty PATH on Unix", () => {
    if (process.platform === "win32") return
    const pathEnv = resolveLoginShellPath()
    assert.ok(pathEnv)
    assert.ok(pathEnv!.length > 0)
    assert.ok(pathEnv!.includes("/"))
  })
})
