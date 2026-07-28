import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, it, beforeEach, afterEach } from "node:test"
import { ProjectDatabase, type SessionRoster } from "./persistence.js"

function tempDbPath(): { dir: string; dbPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gharargah-persist-"))
  return { dir, dbPath: path.join(dir, "jet.sqlite3") }
}

describe("ProjectDatabase session roster", () => {
  let dir: string
  let dbPath: string
  let db: ProjectDatabase

  beforeEach(() => {
    ;({ dir, dbPath } = tempDbPath())
    db = new ProjectDatabase(dbPath)
  })

  afterEach(() => {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("round-trips replace + get", () => {
    const project = db.addProject(dir, "fixture")
    const roster: SessionRoster = {
      version: 2,
      sessions: [
        {
          tabId: "gharargah:terminal:a",
          cwdRootUri: `file://${dir}`,
          label: "Codex",
          launchCommand: "codex",
          ptyId: "term-1",
          status: "running",
          customLabel: "Codex",
          agentId: "codex",
          agentDriverId: "codex:cli",
          lastActivityAt: "2026-07-28T00:00:00.000Z",
        },
      ],
      modal: { tabId: "gharargah:terminal:a", sessionMode: "terminal" },
    }
    const saved = db.replaceSessionRoster(roster)
    assert.equal(saved.sessions.length, 1)
    assert.equal(saved.sessions[0]?.tabId, "gharargah:terminal:a")
    assert.equal(saved.sessions[0]?.ptyId, "term-1")
    assert.equal(saved.modal?.sessionMode, "terminal")
    assert.deepEqual(db.getSessionRoster(), saved)

    const row = db.raw()
      .prepare("SELECT project_id FROM session_roster_entries WHERE tab_id=?")
      .get("gharargah:terminal:a") as { project_id: string | null }
    assert.equal(row.project_id, project.id)
  })

  it("replace clears previous entries and modal", () => {
    db.replaceSessionRoster({
      version: 2,
      sessions: [
        {
          tabId: "gharargah:terminal:old",
          cwdRootUri: "file:///tmp/old",
          label: "Old",
          status: "running",
          ptyId: "term-old",
        },
      ],
      modal: { tabId: "gharargah:terminal:old", sessionMode: "agent" },
    })
    const next = db.replaceSessionRoster({
      version: 2,
      sessions: [
        {
          tabId: "gharargah:terminal:new",
          cwdRootUri: "file:///tmp/new",
          label: "New",
          status: "exited",
          exitCode: 0,
        },
      ],
      modal: null,
    })
    assert.equal(next.sessions.length, 1)
    assert.equal(next.sessions[0]?.tabId, "gharargah:terminal:new")
    assert.equal(next.modal, null)
  })

  it("marks starting/running as failed after reopen (host restart)", () => {
    db.replaceSessionRoster({
      version: 2,
      sessions: [
        {
          tabId: "gharargah:terminal:live",
          cwdRootUri: "file:///tmp/live",
          label: "Live",
          status: "running",
          ptyId: "term-live",
        },
        {
          tabId: "gharargah:terminal:done",
          cwdRootUri: "file:///tmp/done",
          label: "Done",
          status: "exited",
          exitCode: 0,
        },
      ],
      modal: null,
    })
    db.close()

    db = new ProjectDatabase(dbPath)
    const roster = db.getSessionRoster()
    const live = roster.sessions.find(s => s.tabId === "gharargah:terminal:live")
    const done = roster.sessions.find(s => s.tabId === "gharargah:terminal:done")
    assert.equal(live?.status, "failed")
    assert.equal(done?.status, "exited")
  })
})
