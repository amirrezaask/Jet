import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { EditorState } from "@codemirror/state"
import {
  lspOffsetForSymbol,
  normalizeLspLocations,
  symbolRangeAt,
  symbolTextAt,
} from "./lsp-locations.js"

function stateFrom(text: string): EditorState {
  return EditorState.create({ doc: text })
}

describe("symbolRangeAt", () => {
  it("finds word under cursor", () => {
    const state = stateFrom("hello world")
    const range = symbolRangeAt(state, 1)
    assert.deepEqual(range, { from: 0, to: 5 })
    assert.equal(symbolTextAt(state, 1), "hello")
  })

  it("finds word when cursor sits after token", () => {
    const state = stateFrom("MaxRetries = 3")
    // cursor at end of MaxRetries (index 10)
    const range = symbolRangeAt(state, 10)
    assert.deepEqual(range, { from: 0, to: 10 })
    assert.equal(symbolTextAt(state, 10), "MaxRetries")
  })

  it("finds Go package-level identifiers via scan fallback", () => {
    const state = stateFrom("var AppName = \"jet\"\n")
    const nameStart = state.doc.toString().indexOf("AppName")
    const range = symbolRangeAt(state, nameStart + 3)
    assert.deepEqual(range, { from: nameStart, to: nameStart + "AppName".length })
  })

  it("resolves prior token when cursor sits on following whitespace", () => {
    const state = stateFrom("a   b")
    // CM wordAt on space after `a` still yields `a` — matches end-of-token LSP use.
    assert.deepEqual(symbolRangeAt(state, 1), { from: 0, to: 1 })
  })

  it("returns null far from any identifier", () => {
    const state = stateFrom("   ")
    assert.equal(symbolRangeAt(state, 1), null)
  })
})

describe("lspOffsetForSymbol", () => {
  it("keeps interior click position", () => {
    const state = stateFrom("greet(")
    assert.equal(lspOffsetForSymbol(state, 2), 2)
  })

  it("moves end-of-token cursor inside identifier", () => {
    const state = stateFrom("greet(")
    assert.equal(lspOffsetForSymbol(state, 5), 4)
  })
})

describe("normalizeLspLocations", () => {
  it("accepts Location", () => {
    const locs = normalizeLspLocations({
      uri: "file:///a.go",
      range: { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } },
    })
    assert.equal(locs.length, 1)
    assert.equal(locs[0]!.uri, "file:///a.go")
    assert.equal(locs[0]!.range.start.line, 1)
  })

  it("accepts LocationLink", () => {
    const locs = normalizeLspLocations({
      targetUri: "file:///b.go",
      targetRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
      targetSelectionRange: { start: { line: 0, character: 4 }, end: { line: 0, character: 8 } },
    })
    assert.equal(locs.length, 1)
    assert.equal(locs[0]!.uri, "file:///b.go")
    assert.equal(locs[0]!.range.start.character, 4)
  })

  it("flattens arrays and skips junk", () => {
    const locs = normalizeLspLocations([
      null,
      { uri: "file:///c.ts", range: { start: { line: 2, character: 0 }, end: { line: 2, character: 1 } } },
      { nope: true },
    ])
    assert.equal(locs.length, 1)
    assert.equal(locs[0]!.uri, "file:///c.ts")
  })
})
