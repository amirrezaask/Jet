import assert from "node:assert/strict"
import { describe, it, beforeEach } from "node:test"
import type { JetElectronTerminal } from "@gharargah/workspace"
import { reconcileHydratedTerminalPtys } from "./probe-terminal-sessions.js"
import {
  clearTerminalSession,
  hydrateTerminalSession,
  listTerminalSessions,
  markSessionDone,
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

  it("keeps missing pty sessions and marks them starting for respawn", async () => {
    hydrateTerminalSession({
      tabId: "gharargah:terminal:dead",
      cwdRootUri: "file:///tmp/proj",
      ptyId: "term-missing",
      status: "running",
      customLabel: "Dead shell",
    })

    const terminal: Pick<JetElectronTerminal, "attach" | "dispose"> = {
      attach: async () => null,
      dispose: async () => {},
    }

    const dead = await reconcileHydratedTerminalPtys(terminal as JetElectronTerminal)

    assert.deepEqual(dead, [])
    const session = terminalSessionForTab("gharargah:terminal:dead")
    assert.ok(session)
    assert.equal(session.status, "starting")
    assert.equal(session.ptyId, undefined)
  })

  it("keeps done sessions even when pty is missing", async () => {
    hydrateTerminalSession({
      tabId: "gharargah:terminal:done",
      cwdRootUri: "file:///tmp/proj",
      ptyId: "term-missing",
      status: "running",
    })
    markSessionDone("gharargah:terminal:done")

    const terminal: Pick<JetElectronTerminal, "attach" | "dispose"> = {
      attach: async () => null,
      dispose: async () => {},
    }

    const dead = await reconcileHydratedTerminalPtys(terminal as JetElectronTerminal)

    assert.deepEqual(dead, [])
    assert.ok(terminalSessionForTab("gharargah:terminal:done")?.doneAt)
  })

  it("keeps agent CLI sessions with a stored provider session id", async () => {
    hydrateTerminalSession({
      tabId: "gharargah:terminal:agent",
      cwdRootUri: "file:///tmp/proj",
      launchCommand: "codex",
      status: "starting",
      agentId: "codex",
      agentCliSessionId: "11111111-1111-4111-8111-111111111111",
    })

    const terminal: Pick<JetElectronTerminal, "attach" | "dispose"> = {
      attach: async () => null,
      dispose: async () => {},
    }

    const dead = await reconcileHydratedTerminalPtys(terminal as JetElectronTerminal)

    assert.deepEqual(dead, [])
    assert.equal(terminalSessionForTab("gharargah:terminal:agent")?.status, "starting")
  })

  it("maps exited attach results to exited status and keeps session", async () => {
    hydrateTerminalSession({
      tabId: "gharargah:terminal:exited",
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
    const session = terminalSessionForTab("gharargah:terminal:exited")
    assert.ok(session)
    assert.equal(session.status, "exited")
    assert.equal(session.exitCode, 7)
    assert.equal(session.ptyId, "term-exited")
  })

  it("keeps running sessions without ptyId and marks them starting", async () => {
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

    assert.deepEqual(dead, [])
    assert.equal(terminalSessionForTab("gharargah:terminal:orphan")?.status, "starting")
  })

  it("keeps failed sessions without ptyId and marks them starting for respawn", async () => {
    hydrateTerminalSession({
      tabId: "gharargah:terminal:failed",
      cwdRootUri: "file:///tmp/proj",
      status: "failed",
    })

    const terminal: Pick<JetElectronTerminal, "attach"> = {
      attach: async () => null,
    }

    const dead = await reconcileHydratedTerminalPtys(terminal as JetElectronTerminal)

    assert.deepEqual(dead, [])
    assert.equal(terminalSessionForTab("gharargah:terminal:failed")?.status, "starting")
  })
})
