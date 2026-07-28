import assert from "node:assert/strict"
import { test } from "node:test"
import {
  clearTerminalSession,
  markTerminalExited,
  registerTerminalSession,
  terminalSessionForTab,
  trackTerminalPtyId,
} from "./terminal-session.js"

test("an exit received before PTY binding is applied after create resolves", () => {
  const tabId = "terminal:early-exit"
  const ptyId = "pty:early-exit"
  registerTerminalSession(tabId, "file:///tmp", "/bin/sh")

  markTerminalExited(ptyId, 7)
  trackTerminalPtyId(tabId, ptyId)

  const session = terminalSessionForTab(tabId)
  assert.equal(session?.ptyId, ptyId)
  assert.equal(session?.status, "exited")
  assert.equal(session?.exitCode, 7)
  clearTerminalSession(tabId)
})
