import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  sessionIdFromSearch,
  sessionSearchUrl,
} from "./url-workspace.js"

describe("session URL helpers", () => {
  it("parses ?s= session ids", () => {
    assert.equal(sessionIdFromSearch("?s=ses-abc"), "ses-abc")
    assert.equal(sessionIdFromSearch("s=ses-abc&x=1"), "ses-abc")
    assert.equal(sessionIdFromSearch("?x=1"), null)
    assert.equal(sessionIdFromSearch(""), null)
  })

  it("builds session search urls", () => {
    assert.equal(sessionSearchUrl("/dev/yaade", null), "/dev/yaade")
    assert.equal(
      sessionSearchUrl("/dev/yaade", "ses-1"),
      "/dev/yaade?s=ses-1",
    )
    assert.equal(sessionSearchUrl("", "ses-1"), "/?s=ses-1")
  })
})
