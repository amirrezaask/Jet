import { DatabaseSync } from "node:sqlite"
import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { fileUriToPath, pathToFileUri } from "@gharargah/shared"

export type Project = {
  id: string
  name: string
  rootPath: string
  createdAt: string
  updatedAt: string
}

export type SessionRosterStatus = "starting" | "running" | "exited" | "failed"
export type SessionRosterMode = "agent" | "terminal" | "editor" | "git" | "todos"

export type SessionRosterEntry = {
  tabId: string
  cwdRootUri: string
  label: string
  launchCommand?: string
  ptyId?: string
  status: SessionRosterStatus
  exitCode?: number
  customLabel?: string
  agentId?: string
  agentDriverId?: string
  agentThreadId?: string
  lastActivityAt?: string
}

export type SessionRosterModal = {
  tabId: string
  sessionMode: SessionRosterMode
}

export type SessionRoster = {
  version: 2
  sessions: SessionRosterEntry[]
  modal: SessionRosterModal | null
}

type ProjectRow = {
  id: string
  name: string
  root_path: string
  created_at: string
  updated_at: string
}

type RosterEntryRow = {
  tab_id: string
  cwd_root_uri: string
  label: string
  launch_command: string | null
  pty_id: string | null
  status: string
  exit_code: number | null
  custom_label: string | null
  agent_id: string | null
  agent_driver_id: string | null
  agent_thread_id: string | null
  last_activity_at: string | null
}

type RosterModalRow = {
  tab_id: string | null
  session_mode: string | null
}

const EMPTY_ROSTER: SessionRoster = {
  version: 2,
  sessions: [],
  modal: null,
}

const SESSION_STATUSES = new Set<SessionRosterStatus>([
  "starting",
  "running",
  "exited",
  "failed",
])

const SESSION_MODES = new Set<SessionRosterMode>([
  "terminal",
  "agent",
  "editor",
  "git",
  "todos",
])

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function asStatus(value: unknown): SessionRosterStatus | null {
  if (value === "interrupted") return "failed"
  return typeof value === "string" && SESSION_STATUSES.has(value as SessionRosterStatus)
    ? (value as SessionRosterStatus)
    : null
}

function asSessionMode(value: unknown): SessionRosterMode | null {
  return typeof value === "string" && SESSION_MODES.has(value as SessionRosterMode)
    ? (value as SessionRosterMode)
    : null
}

function parseEntry(raw: unknown): SessionRosterEntry | null {
  if (!raw || typeof raw !== "object") return null
  const item = raw as Partial<SessionRosterEntry>
  const tabId = asNonEmptyString(item.tabId)
  const cwdRootUri = asNonEmptyString(item.cwdRootUri)
  const label = asNonEmptyString(item.label) ?? "Terminal"
  const status = asStatus(item.status) ?? "starting"
  if (!tabId || !cwdRootUri) return null
  const entry: SessionRosterEntry = {
    tabId,
    cwdRootUri,
    label,
    status,
  }
  const launchCommand = asNonEmptyString(item.launchCommand)
  if (launchCommand) entry.launchCommand = launchCommand
  const ptyId = asNonEmptyString(item.ptyId)
  if (ptyId) entry.ptyId = ptyId
  const customLabel = asNonEmptyString(item.customLabel)
  if (customLabel) entry.customLabel = customLabel
  if (typeof item.exitCode === "number" && Number.isFinite(item.exitCode)) {
    entry.exitCode = item.exitCode
  }
  const agentId = asNonEmptyString(item.agentId)
  if (agentId) entry.agentId = agentId
  const agentDriverId = asNonEmptyString(item.agentDriverId)
  if (agentDriverId) entry.agentDriverId = agentDriverId
  const agentThreadId = asNonEmptyString(item.agentThreadId)
  if (agentThreadId) entry.agentThreadId = agentThreadId
  const lastActivityAt = asNonEmptyString(item.lastActivityAt)
  if (lastActivityAt) entry.lastActivityAt = lastActivityAt
  return entry
}

function parseModal(raw: unknown): SessionRosterModal | null {
  if (!raw || typeof raw !== "object") return null
  const item = raw as Partial<SessionRosterModal>
  const tabId = asNonEmptyString(item.tabId)
  const sessionMode = asSessionMode(item.sessionMode)
  if (!tabId || !sessionMode) return null
  return { tabId, sessionMode }
}

/** Validate + normalize a PUT body. Returns null when structurally invalid. */
export function parseSessionRosterBody(raw: unknown): SessionRoster | null {
  if (!raw || typeof raw !== "object") return null
  const body = raw as { version?: unknown; sessions?: unknown; modal?: unknown }
  if (body.version !== 1 && body.version !== 2) return null
  if (!Array.isArray(body.sessions)) return null
  const seen = new Set<string>()
  const sessions: SessionRosterEntry[] = []
  for (const item of body.sessions) {
    const entry = parseEntry(item)
    if (!entry || seen.has(entry.tabId)) continue
    seen.add(entry.tabId)
    sessions.push(entry)
  }
  const modal = parseModal(body.modal)
  return {
    version: 2,
    sessions,
    modal: modal && seen.has(modal.tabId) ? modal : null,
  }
}

export class ProjectDatabase {
  readonly db: DatabaseSync

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    this.db = new DatabaseSync(dbPath)
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);
      INSERT OR IGNORE INTO schema_migrations(version) VALUES(1);
      CREATE TABLE IF NOT EXISTS projects(
        id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions(
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, project_id TEXT,
        status TEXT NOT NULL, metadata_json TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      UPDATE sessions SET status='interrupted', updated_at=datetime('now')
        WHERE status IN ('starting','running','waiting');
    `)
    this.ensureSessionRosterSchema()
  }

  private ensureSessionRosterSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_roster_entries(
        tab_id TEXT PRIMARY KEY,
        cwd_root_uri TEXT NOT NULL,
        label TEXT NOT NULL,
        launch_command TEXT,
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
      CREATE TABLE IF NOT EXISTS session_roster_modal(
        id INTEGER PRIMARY KEY CHECK (id = 1),
        tab_id TEXT,
        session_mode TEXT,
        updated_at TEXT NOT NULL
      );
    `)
    this.db
      .prepare("INSERT OR IGNORE INTO schema_migrations(version) VALUES(3)")
      .run()
    this.db.exec(`
      UPDATE session_roster_entries SET status='interrupted', updated_at=datetime('now')
        WHERE status IN ('starting','running');
    `)
  }

  raw(): DatabaseSync {
    return this.db
  }

  projects(): Project[] {
    const rows = this.db
      .prepare(
        "SELECT id,name,root_path,created_at,updated_at FROM projects ORDER BY updated_at DESC",
      )
      .all() as unknown as ProjectRow[]
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      rootPath: row.root_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  project(id: string): Project | null {
    const row = this.db
      .prepare("SELECT id,name,root_path,created_at,updated_at FROM projects WHERE id=?")
      .get(id) as ProjectRow | undefined
    if (!row) return null
    return {
      id: row.id,
      name: row.name,
      rootPath: row.root_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  addProject(rootPath: string, name?: string): Project {
    const root = fs.realpathSync(path.resolve(rootPath))
    const existing = this.db
      .prepare("SELECT id,name,root_path,created_at,updated_at FROM projects WHERE root_path=?")
      .get(root) as ProjectRow | undefined
    if (existing) {
      return {
        id: existing.id,
        name: existing.name,
        rootPath: existing.root_path,
        createdAt: existing.created_at,
        updatedAt: existing.updated_at,
      }
    }
    const now = new Date().toISOString()
    const id = randomUUID()
    const projectName = name?.trim() || path.basename(root) || root
    this.db
      .prepare(
        "INSERT INTO projects(id,name,root_path,created_at,updated_at) VALUES(?,?,?,?,?)",
      )
      .run(id, projectName, root, now, now)
    return { id, name: projectName, rootPath: root, createdAt: now, updatedAt: now }
  }

  removeProject(id: string): boolean {
    const result = this.db.prepare("DELETE FROM projects WHERE id=?").run(id)
    return Number(result.changes) > 0
  }

  recordSession(id: string, kind: string, status: string, metadata: unknown = {}): void {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO sessions(id,kind,project_id,status,metadata_json,created_at,updated_at)
         VALUES(?,?,NULL,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET status=excluded.status, metadata_json=excluded.metadata_json, updated_at=excluded.updated_at`,
      )
      .run(id, kind, status, JSON.stringify(metadata), now, now)
  }

  updateSessionStatus(id: string, status: string): void {
    this.db
      .prepare("UPDATE sessions SET status=?, updated_at=? WHERE id=?")
      .run(status, new Date().toISOString(), id)
  }

  getSessionRoster(): SessionRoster {
    const rows = this.db
      .prepare(
        `SELECT tab_id, cwd_root_uri, label, launch_command, pty_id, status, exit_code,
                custom_label, agent_id, agent_driver_id, agent_thread_id, last_activity_at
         FROM session_roster_entries
         ORDER BY updated_at ASC`,
      )
      .all() as unknown as RosterEntryRow[]

    const sessions: SessionRosterEntry[] = []
    const seen = new Set<string>()
    for (const row of rows) {
      const entry = parseEntry({
        tabId: row.tab_id,
        cwdRootUri: row.cwd_root_uri,
        label: row.label,
        launchCommand: row.launch_command ?? undefined,
        ptyId: row.pty_id ?? undefined,
        status: row.status,
        exitCode: row.exit_code ?? undefined,
        customLabel: row.custom_label ?? undefined,
        agentId: row.agent_id ?? undefined,
        agentDriverId: row.agent_driver_id ?? undefined,
        agentThreadId: row.agent_thread_id ?? undefined,
        lastActivityAt: row.last_activity_at ?? undefined,
      })
      if (!entry || seen.has(entry.tabId)) continue
      seen.add(entry.tabId)
      sessions.push(entry)
    }

    const modalRow = this.db
      .prepare("SELECT tab_id, session_mode FROM session_roster_modal WHERE id=1")
      .get() as RosterModalRow | undefined
    const modal = parseModal(
      modalRow?.tab_id && modalRow.session_mode
        ? { tabId: modalRow.tab_id, sessionMode: modalRow.session_mode }
        : null,
    )

    if (sessions.length === 0) return EMPTY_ROSTER
    return {
      version: 2,
      sessions,
      modal: modal && seen.has(modal.tabId) ? modal : null,
    }
  }

  replaceSessionRoster(roster: SessionRoster): SessionRoster {
    const normalized = parseSessionRosterBody(roster)
    if (!normalized) throw new Error("invalid session roster")

    const now = new Date().toISOString()
    const projectIdByPath = this.projectIdByRootPath()

    this.db.exec("BEGIN")
    try {
      this.db.prepare("DELETE FROM session_roster_entries").run()
      const insert = this.db.prepare(
        `INSERT INTO session_roster_entries(
           tab_id, cwd_root_uri, label, launch_command, pty_id, status, exit_code,
           custom_label, agent_id, agent_driver_id, agent_thread_id, last_activity_at,
           project_id, created_at, updated_at
         ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      for (const entry of normalized.sessions) {
        const cwdRootUri = this.canonicalizeCwdUri(entry.cwdRootUri)
        const projectId = this.resolveProjectId(cwdRootUri, projectIdByPath)
        insert.run(
          entry.tabId,
          cwdRootUri,
          entry.label,
          entry.launchCommand ?? null,
          entry.ptyId ?? null,
          entry.status,
          entry.exitCode ?? null,
          entry.customLabel ?? null,
          entry.agentId ?? null,
          entry.agentDriverId ?? null,
          entry.agentThreadId ?? null,
          entry.lastActivityAt ?? null,
          projectId,
          now,
          now,
        )
      }

      if (normalized.modal) {
        this.db
          .prepare(
            `INSERT INTO session_roster_modal(id, tab_id, session_mode, updated_at)
             VALUES(1,?,?,?)
             ON CONFLICT(id) DO UPDATE SET
               tab_id=excluded.tab_id,
               session_mode=excluded.session_mode,
               updated_at=excluded.updated_at`,
          )
          .run(normalized.modal.tabId, normalized.modal.sessionMode, now)
      } else {
        this.db
          .prepare(
            `INSERT INTO session_roster_modal(id, tab_id, session_mode, updated_at)
             VALUES(1, NULL, NULL, ?)
             ON CONFLICT(id) DO UPDATE SET
               tab_id=NULL, session_mode=NULL, updated_at=excluded.updated_at`,
          )
          .run(now)
      }
      this.db.exec("COMMIT")
    } catch (error) {
      try {
        this.db.exec("ROLLBACK")
      } catch {
        /* ignore */
      }
      throw error
    }

    return this.getSessionRoster()
  }

  private canonicalizeCwdUri(cwdRootUri: string): string {
    try {
      const abs = path.resolve(fileUriToPath(cwdRootUri))
      const real = fs.realpathSync(abs)
      return pathToFileUri(real)
    } catch {
      return cwdRootUri
    }
  }

  private projectIdByRootPath(): Map<string, string> {
    const map = new Map<string, string>()
    for (const project of this.projects()) {
      map.set(path.resolve(project.rootPath), project.id)
      try {
        map.set(fs.realpathSync(project.rootPath), project.id)
      } catch {
        /* keep resolved */
      }
    }
    return map
  }

  private resolveProjectId(
    cwdRootUri: string,
    projectIdByPath: Map<string, string>,
  ): string | null {
    const abs = path.resolve(fileUriToPath(cwdRootUri))
    const direct = projectIdByPath.get(abs)
    if (direct) return direct
    try {
      return projectIdByPath.get(fs.realpathSync(abs)) ?? null
    } catch {
      return null
    }
  }

  close(): void {
    this.db.close()
  }
}
