import { test } from "node:test"
import assert from "node:assert/strict"
import { lspStatusLabel, type LspStatus } from "./lsp-status.js"

test("lspStatusLabel covers all states", () => {
  const statuses: LspStatus[] = [
    "idle",
    "starting",
    "ready",
    "unavailable",
    "disconnected",
    "restarting",
    "failed",
  ]
  for (const s of statuses) {
    assert.ok(lspStatusLabel(s).length > 0)
  }
})
