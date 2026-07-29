import assert from "node:assert/strict"
import { test } from "node:test"
import {
  activeSessionTerminalTabId,
  addSessionTerminal,
  clearTerminalSession,
  listSessionTerminals,
  listTerminalSessions,
  markTerminalExited,
  registerTerminalSession,
  removeSessionTerminal,
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

test("session terminals stay grouped under their parent session", () => {
  const parentTabId = "terminal:agent-session"
  registerTerminalSession(parentTabId, "file:///tmp", "codex")

  const first = addSessionTerminal(parentTabId)
  const second = addSessionTerminal(parentTabId)

  assert.equal(first?.customLabel, "Terminal 1")
  assert.equal(second?.customLabel, "Terminal 2")
  assert.deepEqual(
    listSessionTerminals(parentTabId).map(session => session.tabId),
    [first?.tabId, second?.tabId],
  )
  assert.equal(activeSessionTerminalTabId(parentTabId), second?.tabId)
  assert.deepEqual(
    listTerminalSessions().map(session => session.tabId),
    [parentTabId],
  )

  removeSessionTerminal(parentTabId, second!.tabId)
  assert.equal(activeSessionTerminalTabId(parentTabId), first?.tabId)

  clearTerminalSession(parentTabId)
  assert.equal(terminalSessionForTab(first!.tabId), undefined)
})
