import assert from "node:assert/strict"
import { test } from "node:test"
import {
  activeSessionTerminalTabId,
  addSessionTerminal,
  clearTerminalSession,
  listSessionTerminals,
  listTerminalSessions,
  markTerminalExited,
  markSessionDone,
  recordTerminalOutput,
  recordTerminalUserInput,
  registerTerminalSession,
  removeSessionTerminal,
  restartTerminalSession,
  terminalSessionForTab,
  terminalSessionNeedsCloseConfirmation,
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

test("fresh shell lifecycle does not require close confirmation", () => {
  const tabId = "terminal:fresh-shell"
  registerTerminalSession(tabId, "file:///tmp")

  assert.equal(
    terminalSessionNeedsCloseConfirmation(terminalSessionForTab(tabId)),
    false,
  )

  trackTerminalPtyId(tabId, "pty:fresh-shell")
  recordTerminalOutput(tabId)

  assert.equal(terminalSessionForTab(tabId)?.hasUserInput, false)
  assert.equal(terminalSessionForTab(tabId)?.hasMeaningfulOutput, false)
  assert.equal(
    terminalSessionNeedsCloseConfirmation(terminalSessionForTab(tabId)),
    false,
  )
  clearTerminalSession(tabId)
})

test("user input makes a running shell require close confirmation", () => {
  const tabId = "terminal:used-shell"
  registerTerminalSession(tabId, "file:///tmp")
  trackTerminalPtyId(tabId, "pty:used-shell")

  recordTerminalUserInput(tabId)
  recordTerminalOutput(tabId)

  assert.equal(terminalSessionForTab(tabId)?.hasUserInput, true)
  assert.equal(terminalSessionForTab(tabId)?.hasMeaningfulOutput, true)
  assert.equal(
    terminalSessionNeedsCloseConfirmation(terminalSessionForTab(tabId)),
    true,
  )

  markTerminalExited("pty:used-shell", 0)
  assert.equal(
    terminalSessionNeedsCloseConfirmation(terminalSessionForTab(tabId)),
    false,
  )
  clearTerminalSession(tabId)
})

test("markSessionDone archives session without removing it", () => {
  const tabId = "terminal:done-session"
  registerTerminalSession(tabId, "file:///tmp", "codex")
  trackTerminalPtyId(tabId, "pty:done-session")

  markSessionDone(tabId)

  const session = terminalSessionForTab(tabId)
  assert.ok(session?.doneAt)
  assert.equal(session?.ptyId, undefined)
  assert.equal(session?.status, "exited")
  assert.equal(listTerminalSessions().length, 1)
  clearTerminalSession(tabId)
})

test("launched CLI output is meaningful without user input", () => {
  const tabId = "terminal:cli-output"
  registerTerminalSession(tabId, "file:///tmp", "codex")
  trackTerminalPtyId(tabId, "pty:cli-output")

  recordTerminalOutput(tabId)

  assert.equal(terminalSessionForTab(tabId)?.hasMeaningfulOutput, true)
  assert.equal(
    terminalSessionNeedsCloseConfirmation(terminalSessionForTab(tabId)),
    true,
  )

  restartTerminalSession(tabId)
  assert.equal(terminalSessionForTab(tabId)?.hasUserInput, false)
  assert.equal(terminalSessionForTab(tabId)?.hasMeaningfulOutput, false)
  assert.equal(
    terminalSessionNeedsCloseConfirmation(terminalSessionForTab(tabId)),
    false,
  )
  clearTerminalSession(tabId)
})
