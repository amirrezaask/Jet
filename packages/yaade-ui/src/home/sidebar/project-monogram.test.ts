import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { projectMonogram } from "./project-monogram.js"

describe("project monogram", () => {
  it("uses two initials for separated project names", () => {
    assert.equal(projectMonogram("sample-workspace"), "SW")
    assert.equal(projectMonogram("Yaade Core"), "YC")
    assert.equal(projectMonogram("api_v2"), "AV")
  })

  it("uses one initial for a single-part project name", () => {
    assert.equal(projectMonogram("jet"), "J")
    assert.equal(projectMonogram(" ژرفا "), "ژ")
  })

  it("normalizes compatibility characters and has a stable fallback", () => {
    assert.equal(projectMonogram("ｊｅｔ tools"), "JT")
    assert.equal(projectMonogram("---"), "P")
    assert.equal(projectMonogram(""), "P")
  })
})
