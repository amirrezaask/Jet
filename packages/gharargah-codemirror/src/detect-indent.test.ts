import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { detectIndent } from "./detect-indent.js"

describe("detectIndent", () => {
  it("defaults to 4 spaces for empty input", () => {
    assert.deepEqual(detectIndent(""), { style: "space", size: 4 })
  })

  it("detects tabs", () => {
    const text = "\tfoo\n\t\tbar\n"
    assert.deepEqual(detectIndent(text), { style: "tab", size: 4 })
  })

  it("detects 2-space indent", () => {
    const text = "  foo\n    bar\n  baz\n"
    assert.deepEqual(detectIndent(text), { style: "space", size: 2 })
  })

  it("detects 4-space indent", () => {
    const text = "    foo\n        bar\n"
    assert.deepEqual(detectIndent(text), { style: "space", size: 4 })
  })
})
