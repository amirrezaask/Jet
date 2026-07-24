import assert from "node:assert/strict"
import { describe, it, beforeEach } from "node:test"
import type { JetElectronTerminal } from "@gharargah/workspace"
import { reconcileHydratedTerminalPtys } from "./probe-terminal-sessions.js"
import {
  clearTerminalSession,
  hydrateTerminalSession,
  listTerminalSessions,
  terminalSessionForTab,
} from "./tabs/terminal-session.js"

function clearAllSessions(): void {
  for (const session of listTerminalSessions()) {
    clearTerminalSession(session.tabId)
  }
}

describe("reconcileHydratedTerminalPtys", () => {
  beforeEach(() => {
    clearAllSessions()
  })

  it("marks missing pty sessions failed and keeps the tab identity", async () => {
    hydrateTerminalSession({
      tabId: "gharargah:terminal:dead",
      cwdRootUri: "file:///tmp/proj",
      ptyId: "term-missing",
      status: "running",
      customLabel: "Dead shell",
    })

    const terminal: Pick<JetElectronTerminal, "attach"> = {
      attach: async () => null,
    }

    await reconcileHydratedTerminalPtys(terminal as JetElectronTerminal)

    const session = terminalSessionForTab("gharargah:terminal:dead")
    assert.ok(session)
    assert.equal(session.status, "failed")
    assert.equal(session.ptyId, undefined)
    assert.equal(session.customLabel, "Dead shell")
    assert.equal(listTerminalSessions().length, 1)
  })

  it("maps exited attach results to exited status", async () => {
    hydrateTerminalSession({
      tabId: "gharargah:terminal:done",
      cwdRootUri: "file:///tmp/proj",
      ptyId: "term-exited",
      status: "running",
    })

    const terminal: Pick<JetElectronTerminal, "attach"> = {
      attach: async () => ({
        id: "term-exited",
        output: "",
        lastSequence: 0,
        status: "exited",
        exitCode: 7,
      }),
    }

    await reconcileHydratedTerminalPtys(terminal as JetElectronTerminal)

    const session = terminalSessionForTab("gharargah:terminal:done")
    assert.ok(session)
    assert.equal(session.status, "exited")
    assert.equal(session.exitCode, 7)
    assert.equal(session.ptyId, "term-exited")
  })

  it("marks running sessions without ptyId as unavailable", async () => {
    hydrateTerminalSession({
      tabId: "gharargah:terminal:orphan",
      cwdRootUri: "file:///tmp/proj",
      status: "running",
    })

    const terminal: Pick<JetElectronTerminal, "attach"> = {
      attach: async () => {
        throw new Error("should not attach")
      },
    }

    await reconcileHydratedTerminalPtys(terminal as JetElectronTerminal)

    const session = terminalSessionForTab("gharargah:terminal:orphan")
    assert.ok(session)
    assert.equal(session.status, "failed")
  })
})
