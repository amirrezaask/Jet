import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  isReservedWorkspacePathname,
  projectRootFromLocation,
  resolveHomeRelativePath,
  urlPathForProjectRoot,
  workspaceDocumentTitle,
} from "./url-workspace.js"

describe("url-workspace", () => {
  it("resolves home-relative paths", () => {
    assert.equal(
      resolveHomeRelativePath("/Users/me", "/dev/consultation"),
      "/Users/me/dev/consultation",
    )
    assert.equal(resolveHomeRelativePath("/Users/me", "/"), "/Users/me")
    assert.equal(resolveHomeRelativePath("/Users/me", ""), "/Users/me")
  })

  it("blocks path traversal escaping home", () => {
    assert.equal(
      resolveHomeRelativePath("/Users/me", "/../../etc/passwd"),
      "/Users/me/etc/passwd",
    )
  })

  it("treats api and assets as reserved", () => {
    assert.equal(isReservedWorkspacePathname("/api/v1/rpc"), true)
    assert.equal(isReservedWorkspacePathname("/ws"), true)
    assert.equal(isReservedWorkspacePathname("/dev/consultation"), false)
  })

  it("maps location to project root", () => {
    assert.equal(
      projectRootFromLocation("/Users/me", "/dev/foo"),
      "/Users/me/dev/foo",
    )
    assert.equal(projectRootFromLocation("/Users/me", "/api/v1/x"), null)
  })

  it("builds titles and reverse URL paths", () => {
    assert.equal(
      workspaceDocumentTitle("/Users/me/dev/foo", "/Users/me"),
      "~/dev/foo",
    )
    assert.equal(urlPathForProjectRoot("/Users/me/dev/foo", "/Users/me"), "/dev/foo")
    assert.equal(urlPathForProjectRoot("/Users/me", "/Users/me"), "/")
  })
})
