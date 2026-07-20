import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  extractHoverSignature,
  hoverContentsToPlain,
  plainHoverSnippet,
} from "./hover-signature.js"

describe("extractHoverSignature", () => {
  it("extracts fenced code block signature", () => {
    const text = "```typescript\nfunction greet(name: string): void\n```\n\nDocs here."
    assert.equal(extractHoverSignature(text), "function greet(name: string): void")
  })

  it("extracts rust-analyzer style plain paragraphs", () => {
    const text = [
      "std::vec::Vec",
      "",
      "pub fn push(&mut self, value: T)",
      "",
      "Adds an element to the end.",
    ].join("\n")
    assert.equal(extractHoverSignature(text), "pub fn push(&mut self, value: T)")
  })

  it("stops at prose documentation paragraph", () => {
    const text = [
      "my_mod::Thing",
      "",
      "fn thing() -> i32",
      "",
      "Returns the thing value.",
    ].join("\n")
    assert.equal(extractHoverSignature(text), "fn thing() -> i32")
  })

  it("returns null for empty input", () => {
    assert.equal(extractHoverSignature(""), null)
    assert.equal(extractHoverSignature("   \n\n  "), null)
  })
})

describe("plainHoverSnippet", () => {
  it("returns first non-empty trimmed line", () => {
    assert.equal(plainHoverSnippet("\n  hello world\n\nmore"), "hello world")
  })
})

describe("hoverContentsToPlain", () => {
  it("flattens marked string arrays", () => {
    assert.equal(
      hoverContentsToPlain([{ language: "rust", value: "fn main()" }, "plain"]),
      "fn main()\n\nplain",
    )
  })

  it("reads markup content value", () => {
    assert.equal(
      hoverContentsToPlain({ kind: "markdown", value: "# Title" }),
      "# Title",
    )
  })
})
