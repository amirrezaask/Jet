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

  it("reports missing pty sessions as dead (drop from home)", async () => {
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

    const dead = await reconcileHydratedTerminalPtys(terminal as JetElectronTerminal)

    assert.deepEqual(dead, ["gharargah:terminal:dead"])
    // Session left for caller dispose; status unchanged until close.
    const session = terminalSessionForTab("gharargah:terminal:dead")
    assert.ok(session)
    assert.equal(session.status, "running")
  })

  it("maps exited attach results to exited status and keeps session", async () => {
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

    const dead = await reconcileHydratedTerminalPtys(terminal as JetElectronTerminal)

    assert.deepEqual(dead, [])
    const session = terminalSessionForTab("gharargah:terminal:done")
    assert.ok(session)
    assert.equal(session.status, "exited")
    assert.equal(session.exitCode, 7)
    assert.equal(session.ptyId, "term-exited")
  })

  it("reports running sessions without ptyId as dead", async () => {
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

    const dead = await reconcileHydratedTerminalPtys(terminal as JetElectronTerminal)

    assert.deepEqual(dead, ["gharargah:terminal:orphan"])
  })

  it("reports failed sessions without ptyId as dead", async () => {
    hydrateTerminalSession({
      tabId: "gharargah:terminal:failed",
      cwdRootUri: "file:///tmp/proj",
      status: "failed",
    })

    const terminal: Pick<JetElectronTerminal, "attach"> = {
      attach: async () => null,
    }

    const dead = await reconcileHydratedTerminalPtys(terminal as JetElectronTerminal)

    assert.deepEqual(dead, ["gharargah:terminal:failed"])
  })
})
