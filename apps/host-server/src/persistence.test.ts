import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { describe, it, beforeEach, afterEach } from "node:test"
import { ProjectDatabase, type SessionRoster } from "./persistence.js"

function tempDbPath(): { dir: string; dbPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yaade-persist-"))
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
          tabId: "yaade:terminal:a",
          cwdRootUri: `file://${dir}`,
          label: "Codex",
          launchCommand: "codex",
          launchArgs: ["-c", "notify=[\"bridge\"]"],
          ptyId: "term-1",
          status: "running",
          customLabel: "Codex",
          agentId: "codex",
          agentTitle: "Review session persistence",
          agentDriverId: "codex:cli",
          hasUserInput: true,
          hasMeaningfulOutput: true,
          lastActivityAt: "2026-07-28T00:00:00.000Z",
        },
      ],
      modal: { tabId: "yaade:terminal:a", sessionMode: "terminal" },
    }
    const saved = db.replaceSessionRoster(roster)
    assert.equal(saved.sessions.length, 1)
    assert.equal(saved.sessions[0]?.tabId, "yaade:terminal:a")
    assert.equal(saved.sessions[0]?.ptyId, undefined)
    assert.equal(saved.sessions[0]?.hasUserInput, true)
    assert.equal(saved.sessions[0]?.hasMeaningfulOutput, true)
    assert.equal(saved.modal?.sessionMode, "terminal")
    assert.deepEqual(db.getSessionRoster(), saved)

    const row = db.raw()
      .prepare(
        "SELECT project_id, agent_title, has_user_input, has_meaningful_output FROM session_roster_entries WHERE tab_id=?",
      )
      .get("yaade:terminal:a") as {
        project_id: string | null
        agent_title: string | null
        has_user_input: number
        has_meaningful_output: number
      }
    assert.equal(row.project_id, project.id)
    assert.equal(row.agent_title, "Review session persistence")
    assert.equal(row.has_user_input, 1)
    assert.equal(row.has_meaningful_output, 1)
  })

  it("replace clears previous entries and modal", () => {
    db.replaceSessionRoster({
      version: 2,
      sessions: [
        {
          tabId: "yaade:terminal:old",
          cwdRootUri: "file:///tmp/old",
          label: "Old Codex",
          status: "running",
          launchCommand: "codex",
          agentId: "codex",
        },
      ],
      modal: { tabId: "yaade:terminal:old", sessionMode: "agent" },
    })
    const next = db.replaceSessionRoster({
      version: 2,
      sessions: [
        {
          tabId: "yaade:terminal:new",
          cwdRootUri: "file:///tmp/new",
          label: "New Claude",
          status: "exited",
          exitCode: 0,
          launchCommand: "claude",
          agentId: "claude",
        },
      ],
      modal: null,
    })
    assert.equal(next.sessions.length, 1)
    assert.equal(next.sessions[0]?.tabId, "yaade:terminal:new")
    assert.equal(next.modal, null)
  })

  it("persists archived transcript and drops it for active sessions", () => {
    const marker = "ARCHIVED_TRANSCRIPT_MARKER"
    const base = {
      tabId: "yaade:terminal:archive-output",
      cwdRootUri: `file://${dir}`,
      label: "Codex archive",
      launchCommand: "codex",
      status: "exited" as const,
      agentId: "codex",
      transcript: marker,
    }
    const archived = db.replaceSessionRoster({
      version: 2,
      sessions: [{ ...base, doneAt: "2026-08-01T00:00:00.000Z" }],
      modal: null,
    })
    assert.equal(archived.sessions[0]?.transcript, marker)

    const active = db.replaceSessionRoster({
      version: 2,
      sessions: [{ ...base, status: "starting" }],
      modal: null,
    })
    assert.equal(active.sessions[0]?.transcript, undefined)
  })

  it("accepts blank shells alongside agent sessions on replace", () => {
    const saved = db.replaceSessionRoster({
      version: 2,
      sessions: [
        {
          tabId: "yaade:terminal:shell",
          cwdRootUri: "file:///tmp/shell",
          label: "Shell",
          status: "running",
          ptyId: "term-shell",
        },
        {
          tabId: "yaade:terminal:agent",
          cwdRootUri: "file:///tmp/agent",
          label: "Codex",
          status: "running",
          launchCommand: "codex",
          agentId: "codex",
        },
      ],
      modal: null,
    })
    assert.equal(saved.sessions.length, 2)
    assert.equal(
      saved.sessions.some(s => s.tabId === "yaade:terminal:shell"),
      true,
    )
    assert.equal(
      saved.sessions.some(s => s.tabId === "yaade:terminal:agent"),
      true,
    )
  })

  it("marks open sessions as starting after reopen (host restart)", () => {
    db.replaceSessionRoster({
      version: 2,
      sessions: [
        {
          tabId: "yaade:terminal:live",
          cwdRootUri: "file:///tmp/live",
          label: "Live",
          status: "running",
          ptyId: "term-live",
        },
        {
          tabId: "yaade:terminal:agent",
          cwdRootUri: "file:///tmp/agent",
          label: "Codex",
          status: "running",
          launchCommand: "codex",
          agentId: "codex",
          agentCliSessionId: "11111111-1111-4111-8111-111111111111",
        },
      ],
      modal: null,
    })
    db.close()

    db = new ProjectDatabase(dbPath)
    const roster = db.getSessionRoster()
    const live = roster.sessions.find(s => s.tabId === "yaade:terminal:live")
    const agent = roster.sessions.find(s => s.tabId === "yaade:terminal:agent")
    assert.equal(roster.sessions.length, 2)
    assert.equal(live?.status, "starting")
    assert.equal(live?.ptyId, undefined)
    assert.equal(agent?.status, "starting")
    assert.equal(agent?.ptyId, undefined)
    assert.equal(agent?.agentCliSessionId, "11111111-1111-4111-8111-111111111111")
  })

  it("round-trips archive time, provider session id, and stable agent title", () => {
    db.replaceSessionRoster({
      version: 2,
      sessions: [
        {
          tabId: "yaade:terminal:archived",
          cwdRootUri: "file:///tmp/archived",
          label: "Archived",
          status: "exited",
          launchCommand: "claude",
          doneAt: "2026-07-30T00:00:00.000Z",
          agentId: "claude",
          agentTitle: "Implement robust archive restore",
          agentCliSessionId: "22222222-2222-4222-8222-222222222222",
        },
      ],
      modal: null,
    })
    const roster = db.getSessionRoster()
    assert.equal(roster.sessions[0]?.doneAt, "2026-07-30T00:00:00.000Z")
    assert.equal(
      roster.sessions[0]?.agentCliSessionId,
      "22222222-2222-4222-8222-222222222222",
    )
    assert.equal(
      roster.sessions[0]?.agentTitle,
      "Implement robust archive restore",
    )
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
        tab_id, cwd_root_uri, label, launch_command, agent_id, status, created_at, updated_at
      ) VALUES(
        'yaade:terminal:legacy', 'file:///tmp/legacy', 'Legacy agent title',
        'codex', 'codex', 'exited',
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
    assert.equal(columns.some(column => column.name === "agent_title"), true)
    assert.equal(
      columns.some(column => column.name === "has_meaningful_output"),
      true,
    )
    const restored = db.getSessionRoster().sessions[0]
    // Blank shells survive host reopen; only incomplete agent stubs are stripped.
    assert.equal(restored?.tabId, "yaade:terminal:legacy")
    assert.equal(restored?.label, "Legacy agent title")
    assert.equal(restored?.agentTitle, "Legacy agent title")
    assert.equal(restored?.status, "exited")
  })

  it("persists blank shell sessions without agentId", () => {
    const saved = db.replaceSessionRoster({
      version: 2,
      sessions: [
        {
          tabId: "yaade:terminal:blank",
          cwdRootUri: "file:///tmp/blank",
          label: "Terminal",
          status: "running",
        },
      ],
      modal: { tabId: "yaade:terminal:blank", sessionMode: "terminal" },
    })
    assert.equal(saved.sessions.length, 1)
    assert.equal(saved.sessions[0]?.agentId, undefined)
    assert.equal(saved.sessions[0]?.launchCommand, undefined)
    assert.deepEqual(db.getSessionRoster(), saved)
  })
})
