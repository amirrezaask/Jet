import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { TextDocumentSyncKind } from "vscode-languageserver-protocol"
import { lspContentChanges } from "./document-sync.js"

const change = {
  range: {
    startLineNumber: 2,
    startColumn: 3,
    endLineNumber: 2,
    endColumn: 5,
  },
  rangeLength: 2,
  text: "xy",
}

describe("LSP document sync", () => {
  it("maps incremental changes without reading the whole model", () => {
    let fullReads = 0
    const result = lspContentChanges(
      TextDocumentSyncKind.Incremental,
      [change],
      () => {
        fullReads++
        return "whole document"
      },
    )

    assert.equal(fullReads, 0)
    assert.deepEqual(result, [
      {
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 4 },
        },
        rangeLength: 2,
        text: "xy",
      },
    ])
  })

  it("serializes once only for full synchronization", () => {
    let fullReads = 0
    assert.deepEqual(
      lspContentChanges(TextDocumentSyncKind.Full, [change], () => {
        fullReads++
        return "whole document"
      }),
      [{ text: "whole document" }],
    )
    assert.equal(fullReads, 1)
  })
})
