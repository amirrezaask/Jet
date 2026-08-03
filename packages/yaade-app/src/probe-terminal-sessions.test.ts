import assert from "node:assert/strict"
import { describe, it, beforeEach } from "node:test"
import type { JetElectronTerminal } from "@yaade/workspace"
import { reconcileHydratedTerminalPtys } from "./probe-terminal-sessions.js"
import {
  clearTerminalSession,
  hydrateTerminalSession,
  listTerminalSessions,
  archiveSession,
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
      tabId: "yaade:terminal:dead",
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
    const session = terminalSessionForTab("yaade:terminal:dead")
    assert.ok(session)
    assert.equal(session.status, "starting")
    assert.equal(session.ptyId, undefined)
  })

  it("keeps archived sessions even when pty is missing", async () => {
    hydrateTerminalSession({
      tabId: "yaade:terminal:archived",
      cwdRootUri: "file:///tmp/proj",
      ptyId: "term-missing",
      status: "running",
    })
    archiveSession("yaade:terminal:archived")

    const terminal: Pick<JetElectronTerminal, "attach" | "dispose"> = {
      attach: async () => null,
      dispose: async () => {},
    }

    const dead = await reconcileHydratedTerminalPtys(terminal as JetElectronTerminal)

    assert.deepEqual(dead, [])
    assert.ok(terminalSessionForTab("yaade:terminal:archived")?.archivedAt)
  })

  it("keeps agent CLI sessions with a stored provider session id", async () => {
    hydrateTerminalSession({
      tabId: "yaade:terminal:agent",
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
    assert.equal(terminalSessionForTab("yaade:terminal:agent")?.status, "starting")
  })

  it("maps exited attach results to exited status and keeps session", async () => {
    hydrateTerminalSession({
      tabId: "yaade:terminal:exited",
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
    const session = terminalSessionForTab("yaade:terminal:exited")
    assert.ok(session)
    assert.equal(session.status, "exited")
    assert.equal(session.exitCode, 7)
    assert.equal(session.ptyId, "term-exited")
  })

  it("keeps running sessions without ptyId and marks them starting", async () => {
    hydrateTerminalSession({
      tabId: "yaade:terminal:orphan",
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
    assert.equal(terminalSessionForTab("yaade:terminal:orphan")?.status, "starting")
  })

  it("keeps failed sessions without ptyId and marks them starting for respawn", async () => {
    hydrateTerminalSession({
      tabId: "yaade:terminal:failed",
      cwdRootUri: "file:///tmp/proj",
      status: "failed",
    })

    const terminal: Pick<JetElectronTerminal, "attach"> = {
      attach: async () => null,
    }

    const dead = await reconcileHydratedTerminalPtys(terminal as JetElectronTerminal)

    assert.deepEqual(dead, [])
    assert.equal(terminalSessionForTab("yaade:terminal:failed")?.status, "starting")
  })
})
