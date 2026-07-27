import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { monacoLanguageId, isLargeFile } from "./language.js"

describe("monacoLanguageId", () => {
  it("maps tsx to typescript", () => {
    assert.equal(monacoLanguageId("tsx"), "typescript")
  })

  it("maps jsx to javascript", () => {
    assert.equal(monacoLanguageId("jsx"), "javascript")
  })

  it("maps mts and cts to typescript", () => {
    assert.equal(monacoLanguageId("mts"), "typescript")
    assert.equal(monacoLanguageId("cts"), "typescript")
  })

  it("maps plaintext variants", () => {
    assert.equal(monacoLanguageId("plaintext"), "plaintext")
    assert.equal(monacoLanguageId("text"), "plaintext")
  })

  it("passes through known languages", () => {
    assert.equal(monacoLanguageId("rust"), "rust")
    assert.equal(monacoLanguageId("go"), "go")
  })

  it("normalizes case", () => {
    assert.equal(monacoLanguageId("TSX"), "typescript")
  })
})

describe("isLargeFile", () => {
  it("returns false for small content", () => {
    assert.equal(isLargeFile("hello\nworld"), false)
  })

  it("returns true when content exceeds 4MB", () => {
    assert.equal(isLargeFile("x".repeat(4 * 1024 * 1024 + 1)), true)
  })

  it("returns true when line count exceeds 200k", () => {
    const lines = Array.from({ length: 200_002 }, () => "a").join("\n")
    assert.equal(isLargeFile(lines), true)
  })
})
