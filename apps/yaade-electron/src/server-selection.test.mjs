import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  normalizeServerUrl,
  readServerSelection,
  writeServerSelection,
} from "./server-selection.mjs"

test("normalizes a remote server to its origin", () => {
  assert.equal(normalizeServerUrl(" https://yaade.example:8443/ "), "https://yaade.example:8443")
})

test("rejects unsafe or unsupported server URLs", () => {
  assert.throws(() => normalizeServerUrl("file:///tmp/server"), /http/)
  assert.throws(() => normalizeServerUrl("https://user:secret@example.test"), /credentials/)
  assert.throws(() => normalizeServerUrl("https://example.test/yaade"), /path/)
})

test("persists and reads the selected remote server", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yaade-server-selection-"))
  const configPath = path.join(tempDir, "server.json")
  try {
    writeServerSelection(configPath, "https://yaade.example")
    assert.equal(readServerSelection(configPath), "https://yaade.example")
    assert.deepEqual(JSON.parse(fs.readFileSync(configPath, "utf8")), {
      serverUrl: "https://yaade.example",
      version: 1,
    })
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
