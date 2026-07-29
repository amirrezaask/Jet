import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
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
          launchArgs: ["-c", "notify=[\"bridge\"]"],
          ptyId: "term-1",
          status: "running",
          customLabel: "Codex",
          agentId: "codex",
          agentDriverId: "codex:cli",
          hasUserInput: true,
          hasMeaningfulOutput: true,
          lastActivityAt: "2026-07-28T00:00:00.000Z",
        },
      ],
      modal: { tabId: "gharargah:terminal:a", sessionMode: "terminal" },
    }
    const saved = db.replaceSessionRoster(roster)
    assert.equal(saved.sessions.length, 1)
    assert.equal(saved.sessions[0]?.tabId, "gharargah:terminal:a")
    assert.equal(saved.sessions[0]?.ptyId, "term-1")
    assert.equal(saved.sessions[0]?.hasUserInput, true)
    assert.equal(saved.sessions[0]?.hasMeaningfulOutput, true)
    assert.equal(saved.modal?.sessionMode, "terminal")
    assert.deepEqual(db.getSessionRoster(), saved)

    const row = db.raw()
      .prepare(
        "SELECT project_id, has_user_input, has_meaningful_output FROM session_roster_entries WHERE tab_id=?",
      )
      .get("gharargah:terminal:a") as {
        project_id: string | null
        has_user_input: number
        has_meaningful_output: number
      }
    assert.equal(row.project_id, project.id)
    assert.equal(row.has_user_input, 1)
    assert.equal(row.has_meaningful_output, 1)
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

  it("migrates pre-usage-evidence roster tables with safe false defaults", () => {
    db.close()
    fs.rmSync(dbPath, { force: true })
    const legacy = new DatabaseSync(dbPath)
    legacy.exec(`
      CREATE TABLE session_roster_entries(
        tab_id TEXT PRIMARY KEY,
        cwd_root_uri TEXT NOT NULL,
        label TEXT NOT NULL,
        launch_command TEXT,
        launch_args_json TEXT,
        pty_id TEXT,
        status TEXT NOT NULL,
        exit_code INTEGER,
        custom_label TEXT,
        agent_id TEXT,
        agent_driver_id TEXT,
        agent_thread_id TEXT,
        last_activity_at TEXT,
        project_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO session_roster_entries(
        tab_id, cwd_root_uri, label, status, created_at, updated_at
      ) VALUES(
        'gharargah:terminal:legacy', 'file:///tmp/legacy', 'Legacy', 'exited',
        '2026-07-28T00:00:00.000Z', '2026-07-28T00:00:00.000Z'
      );
    `)
    legacy.close()

    db = new ProjectDatabase(dbPath)
    const columns = db
      .raw()
      .prepare("PRAGMA table_info(session_roster_entries)")
      .all() as unknown as Array<{ name: string }>
    assert.equal(columns.some(column => column.name === "has_user_input"), true)
    assert.equal(
      columns.some(column => column.name === "has_meaningful_output"),
      true,
    )
    const restored = db.getSessionRoster().sessions[0]
    assert.equal(restored?.hasUserInput, undefined)
    assert.equal(restored?.hasMeaningfulOutput, undefined)
  })
})
