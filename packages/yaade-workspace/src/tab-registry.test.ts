import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  canonicalizeTerminalTabId,
  isTerminalTabId,
  terminalSessionKeyFromTabId,
  terminalTabId,
} from "./tab-registry.js"

describe("terminal tab id canonicalize", () => {
  it("keeps canonical yaade ids stable", () => {
    const id = terminalTabId("session-1")
    assert.equal(id, "yaade:terminal:session-1")
    assert.equal(terminalSessionKeyFromTabId(id), "session-1")
    assert.equal(canonicalizeTerminalTabId(id), id)
    assert.equal(isTerminalTabId(id), true)
  })

  it("maps legacy gharargah / jet prefixes onto yaade", () => {
    assert.equal(
      canonicalizeTerminalTabId("gharargah:terminal:session-9"),
      "yaade:terminal:session-9",
    )
    assert.equal(
      canonicalizeTerminalTabId("jet:terminal:session-9"),
      "yaade:terminal:session-9",
    )
    assert.equal(isTerminalTabId("gharargah:terminal:session-9"), true)
  })

  it("unwraps nested legacy prefixes from broken hydrate", () => {
    assert.equal(
      canonicalizeTerminalTabId(
        "yaade:terminal:gharargah:terminal:session-1785713553807",
      ),
      "yaade:terminal:session-1785713553807",
    )
    assert.equal(
      terminalSessionKeyFromTabId(
        "yaade:terminal:gharargah:terminal:session-1785713553807",
      ),
      "session-1785713553807",
    )
  })

  it("rejects non-terminal ids", () => {
    assert.equal(terminalSessionKeyFromTabId("yaade:explorer"), null)
    assert.equal(isTerminalTabId("file:///tmp/a.ts"), false)
    assert.equal(canonicalizeTerminalTabId("file:///tmp/a.ts"), "file:///tmp/a.ts")
  })
})
