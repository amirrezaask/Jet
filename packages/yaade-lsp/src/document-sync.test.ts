import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { TextDocumentSyncKind } from "vscode-languageserver-protocol"
import {
  createFullDocumentSyncScheduler,
  lspContentChanges,
} from "./document-sync.js"

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

  it("coalesces full sync without serializing on each keystroke", async () => {
    let scheduled: (() => void) | null = null
    let reads = 0
    let version = 1
    const sent: Array<{ version: number; text: string }> = []
    const scheduler = createFullDocumentSyncScheduler({
      getVersion: () => version,
      getText: () => {
        reads++
        return `version ${version}`
      },
      send: async (sentVersion, text) => {
        sent.push({ version: sentVersion, text })
      },
      setTimer: callback => {
        scheduled = callback
        return callback
      },
      clearTimer: () => {
        scheduled = null
      },
    })

    scheduler.schedule()
    version = 2
    scheduler.schedule()
    version = 3
    scheduler.schedule()
    assert.equal(reads, 0)
    const run = scheduled as (() => void) | null
    assert.ok(run)
    run()
    await scheduler.flush()
    assert.equal(reads, 1)
    assert.deepEqual(sent, [{ version: 3, text: "version 3" }])
  })
})
