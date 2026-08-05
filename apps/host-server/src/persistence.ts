import { DatabaseSync } from "node:sqlite"
import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import {
  EMPTY_SESSION_ROSTER,
  emptyProjectSessionPayload,
  emptyWorkspaceSession,
  tryDecodeProjectSessionPayload,
  tryDecodeSessionRoster,
  tryDecodeWorkspaceSession,
  type ProjectSession,
  type ProjectSessionPayload,
  type ProjectSessionSummary,
  type SessionRoster,
  type SessionRosterEntry,
  type SessionRosterMode,
  type TerminalSessionStatus,
  type WorkspaceSession,
} from "@yaade/rpc"
import { fileUriToPath, pathToFileUri } from "@yaade/shared"

export type Project = {
  id: string
  name: string
  rootPath: string
  createdAt: string
  updatedAt: string
}

export type SessionRosterStatus = TerminalSessionStatus
export type { SessionRosterMode, SessionRosterEntry, SessionRoster }

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
  launch_args_json: string | null
  pty_id: string | null
  status: string
  exit_code: number | null
  custom_label: string | null
  agent_id: string | null
  agent_title: string | null
  agent_driver_id: string | null
  agent_thread_id: string | null
  agent_cli_session_id: string | null
  has_user_input: number
  has_meaningful_output: number
  last_activity_at: string | null
  done_at: string | null
  transcript: string | null
}

type RosterModalRow = {
  tab_id: string | null
  session_mode: string | null
}

function parseLaunchArgsJson(value: string | null): unknown {
  if (!value) return undefined
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

/** Validate + normalize a PUT body. Returns null when structurally invalid. */
export function parseSessionRosterBody(raw: unknown): SessionRoster | null {
  return tryDecodeSessionRoster(raw)
}

export class ProjectDatabase {
  readonly db: DatabaseSync
  private closed = false

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
    this.ensureWorkspaceSessionSchema()
    this.ensureProjectSessionSchema()
  }

  private ensureWorkspaceSessionSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_sessions(
        machine TEXT NOT NULL,
        root_path TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (machine, root_path)
      );
    `)
  }

  private ensureProjectSessionSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS project_sessions(
        id TEXT PRIMARY KEY,
        machine TEXT NOT NULL,
        project_path TEXT NOT NULL,
        cwd_path TEXT NOT NULL,
        title TEXT NOT NULL,
        worktree_branch TEXT,
        worktree_path TEXT,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );
      CREATE INDEX IF NOT EXISTS project_sessions_by_project
        ON project_sessions (machine, project_path, updated_at DESC);
    `)
    this.migrateWorkspaceSessionsToProjectSessions()
  }

  /** One-time: copy legacy workspace_sessions rows into project_sessions. */
  private migrateWorkspaceSessionsToProjectSessions(): void {
    const migrated = this.db
      .prepare("SELECT version FROM schema_migrations WHERE version=8")
      .get() as { version: number } | undefined
    if (migrated) return

    const rows = this.db
      .prepare(
        "SELECT machine, root_path, payload_json, updated_at FROM workspace_sessions",
      )
      .all() as unknown as Array<{
      machine: string
      root_path: string
      payload_json: string
      updated_at: string
    }>

    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO project_sessions(
         id, machine, project_path, cwd_path, title,
         worktree_branch, worktree_path, payload_json,
         created_at, updated_at, archived_at
       ) VALUES(?,?,?,?,?,?,?,?,?,?,NULL)`,
    )

    for (const row of rows) {
      let payload = emptyProjectSessionPayload()
      try {
        const decoded = tryDecodeWorkspaceSession(JSON.parse(row.payload_json))
        if (decoded) {
          payload = {
            version: 1,
            layout: decoded.layout,
            sessions: decoded.sessions,
            ...(decoded.gitRoots ? { gitRoots: decoded.gitRoots } : {}),
            ...(decoded.editorFiles ? { editorFiles: decoded.editorFiles } : {}),
          }
        }
      } catch {
        /* keep empty payload */
      }
      const root = this.canonicalizeRootPath(row.root_path)
      insert.run(
        `ses-${randomUUID()}`,
        row.machine,
        root,
        root,
        "Session 1",
        null,
        null,
        JSON.stringify(payload),
        row.updated_at,
        row.updated_at,
      )
    }

    this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version) VALUES(8)").run()
  }

  private ensureSessionRosterSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_roster_entries(
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
        agent_title TEXT,
        agent_driver_id TEXT,
        agent_thread_id TEXT,
        agent_cli_session_id TEXT,
        has_user_input INTEGER NOT NULL DEFAULT 0,
        has_meaningful_output INTEGER NOT NULL DEFAULT 0,
        last_activity_at TEXT,
        done_at TEXT,
        transcript TEXT,
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
    const columns = this.db
      .prepare("PRAGMA table_info(session_roster_entries)")
      .all() as unknown as Array<{ name: string }>
    if (!columns.some(column => column.name === "launch_args_json")) {
      this.db.exec(
        "ALTER TABLE session_roster_entries ADD COLUMN launch_args_json TEXT",
      )
    }
    if (!columns.some(column => column.name === "has_user_input")) {
      this.db.exec(
        "ALTER TABLE session_roster_entries ADD COLUMN has_user_input INTEGER NOT NULL DEFAULT 0",
      )
    }
    if (!columns.some(column => column.name === "has_meaningful_output")) {
      this.db.exec(
        "ALTER TABLE session_roster_entries ADD COLUMN has_meaningful_output INTEGER NOT NULL DEFAULT 0",
      )
    }
    if (!columns.some(column => column.name === "done_at")) {
      this.db.exec("ALTER TABLE session_roster_entries ADD COLUMN done_at TEXT")
    }
    if (!columns.some(column => column.name === "agent_cli_session_id")) {
      this.db.exec(
        "ALTER TABLE session_roster_entries ADD COLUMN agent_cli_session_id TEXT",
      )
    }
    if (!columns.some(column => column.name === "agent_title")) {
      this.db.exec(
        "ALTER TABLE session_roster_entries ADD COLUMN agent_title TEXT",
      )
    }
    if (!columns.some(column => column.name === "transcript")) {
      this.db.exec(
        "ALTER TABLE session_roster_entries ADD COLUMN transcript TEXT",
      )
    }
    this.db.exec(`
      UPDATE session_roster_entries
         SET agent_title=COALESCE(NULLIF(TRIM(custom_label), ''), label)
       WHERE agent_id IS NOT NULL
         AND TRIM(COALESCE(agent_id, '')) != ''
         AND (agent_title IS NULL OR TRIM(agent_title) = '');
    `)
    this.db
      .prepare("INSERT OR IGNORE INTO schema_migrations(version) VALUES(7)")
      .run()
    // Keep all roster rows across host restart (including blank shells).
    // Drop incomplete agent stubs only (agent_id set but no launch_command).
    this.db.exec(`
      DELETE FROM session_roster_entries
        WHERE agent_id IS NOT NULL AND TRIM(COALESCE(agent_id, '')) != ''
          AND (launch_command IS NULL OR TRIM(COALESCE(launch_command, '')) = '');
      UPDATE session_roster_entries SET status='starting', pty_id=NULL, updated_at=datetime('now')
        WHERE status IN ('starting','running')
          AND (done_at IS NULL OR TRIM(COALESCE(done_at, '')) = '');
      UPDATE session_roster_modal SET tab_id=NULL, session_mode=NULL, updated_at=datetime('now')
        WHERE tab_id IS NOT NULL
          AND tab_id NOT IN (SELECT tab_id FROM session_roster_entries);
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
        `SELECT tab_id, cwd_root_uri, label, launch_command, launch_args_json, pty_id, status, exit_code,
                custom_label, agent_id, agent_title, agent_driver_id, agent_thread_id, agent_cli_session_id,
                has_user_input, has_meaningful_output, last_activity_at, done_at, transcript
         FROM session_roster_entries
         ORDER BY updated_at ASC`,
      )
      .all() as unknown as RosterEntryRow[]

    const sessions = rows.map(row => ({
      tabId: row.tab_id,
      cwdRootUri: row.cwd_root_uri,
      label: row.label,
      launchCommand: row.launch_command ?? undefined,
      launchArgs: parseLaunchArgsJson(row.launch_args_json),
      ptyId: row.pty_id ?? undefined,
      status: row.status,
      exitCode: row.exit_code ?? undefined,
      customLabel: row.custom_label ?? undefined,
      agentId: row.agent_id ?? undefined,
      agentTitle: row.agent_title ?? undefined,
      agentDriverId: row.agent_driver_id ?? undefined,
      agentThreadId: row.agent_thread_id ?? undefined,
      agentCliSessionId: row.agent_cli_session_id ?? undefined,
      hasUserInput: row.has_user_input === 1,
      hasMeaningfulOutput: row.has_meaningful_output === 1,
      lastActivityAt: row.last_activity_at ?? undefined,
      doneAt: row.done_at ?? undefined,
      transcript: row.transcript ?? undefined,
    }))

    const modalRow = this.db
      .prepare("SELECT tab_id, session_mode FROM session_roster_modal WHERE id=1")
      .get() as RosterModalRow | undefined
    const modal =
      modalRow?.tab_id && modalRow.session_mode
        ? { tabId: modalRow.tab_id, sessionMode: modalRow.session_mode }
        : null

    return (
      tryDecodeSessionRoster({ version: 2, sessions, modal }) ?? EMPTY_SESSION_ROSTER
    )
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
           tab_id, cwd_root_uri, label, launch_command, launch_args_json, pty_id, status, exit_code,
           custom_label, agent_id, agent_title, agent_driver_id, agent_thread_id, agent_cli_session_id,
           has_user_input, has_meaningful_output, last_activity_at, done_at, transcript,
           project_id, created_at, updated_at
         ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      for (const entry of normalized.sessions) {
        const cwdRootUri = this.canonicalizeCwdUri(entry.cwdRootUri)
        const projectId = this.resolveProjectId(cwdRootUri, projectIdByPath)
        insert.run(
          entry.tabId,
          cwdRootUri,
          entry.label,
          entry.launchCommand ?? null,
          entry.launchArgs ? JSON.stringify(entry.launchArgs) : null,
          null,
          entry.status,
          entry.exitCode ?? null,
          entry.customLabel ?? null,
          entry.agentId ?? null,
          entry.agentTitle ?? null,
          entry.agentDriverId ?? null,
          entry.agentThreadId ?? null,
          entry.agentCliSessionId ?? null,
          entry.hasUserInput ? 1 : 0,
          entry.hasMeaningfulOutput ? 1 : 0,
          entry.lastActivityAt ?? null,
          entry.doneAt ?? null,
          entry.doneAt ? entry.transcript ?? null : null,
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

  private canonicalizeRootPath(rootPath: string): string {
    try {
      return fs.realpathSync(path.resolve(rootPath))
    } catch {
      return path.resolve(rootPath)
    }
  }

  getWorkspaceSession(machine: string, rootPath: string): WorkspaceSession {
    const root = this.canonicalizeRootPath(rootPath)
    const row = this.db
      .prepare(
        "SELECT payload_json FROM workspace_sessions WHERE machine=? AND root_path=?",
      )
      .get(machine, root) as { payload_json: string } | undefined
    if (!row?.payload_json) {
      return emptyWorkspaceSession(machine, root)
    }
    try {
      const decoded = tryDecodeWorkspaceSession(JSON.parse(row.payload_json))
      if (decoded) {
        return {
          ...decoded,
          machine,
          rootPath: root,
        }
      }
    } catch {
      /* corrupt row */
    }
    return emptyWorkspaceSession(machine, root)
  }

  replaceWorkspaceSession(session: WorkspaceSession): WorkspaceSession {
    const normalized = tryDecodeWorkspaceSession(session)
    if (!normalized) throw new Error("invalid workspace session")
    const root = this.canonicalizeRootPath(normalized.rootPath)
    const machine = normalized.machine.trim()
    if (!machine) throw new Error("invalid workspace session machine")

    // Keep ptyId so a same-host reload can reattach. After a host restart the
    // client attach fails and TerminalPanel spawns a fresh shell.
    const sessions = normalized.sessions.map(leaf => ({
      ...leaf,
      cwdRootUri: this.canonicalizeCwdUri(leaf.cwdRootUri),
      ...(leaf.liveCwdUri
        ? { liveCwdUri: this.canonicalizeCwdUri(leaf.liveCwdUri) }
        : {}),
    }))

    const payload: WorkspaceSession = {
      version: 1,
      machine,
      rootPath: root,
      layout: normalized.layout,
      sessions,
      ...(normalized.gitRoots ? { gitRoots: normalized.gitRoots } : {}),
    }
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO workspace_sessions(machine, root_path, payload_json, updated_at)
         VALUES(?,?,?,?)
         ON CONFLICT(machine, root_path) DO UPDATE SET
           payload_json=excluded.payload_json,
           updated_at=excluded.updated_at`,
      )
      .run(machine, root, JSON.stringify(payload), now)
    return payload
  }

  listProjectSessions(
    machine: string,
    projectPath: string,
  ): ProjectSessionSummary[] {
    const root = this.canonicalizeRootPath(projectPath)
    const rows = this.db
      .prepare(
        `SELECT id, machine, project_path, cwd_path, title,
                worktree_branch, worktree_path, created_at, updated_at, archived_at
           FROM project_sessions
          WHERE machine=? AND project_path=?
          ORDER BY updated_at DESC`,
      )
      .all(machine, root) as unknown as Array<{
      id: string
      machine: string
      project_path: string
      cwd_path: string
      title: string
      worktree_branch: string | null
      worktree_path: string | null
      created_at: string
      updated_at: string
      archived_at: string | null
    }>
    return rows.map(row => this.mapProjectSessionSummary(row))
  }

  getProjectSession(id: string): ProjectSession | null {
    const row = this.db
      .prepare(
        `SELECT id, machine, project_path, cwd_path, title,
                worktree_branch, worktree_path, payload_json,
                created_at, updated_at, archived_at
           FROM project_sessions WHERE id=?`,
      )
      .get(id) as
      | {
          id: string
          machine: string
          project_path: string
          cwd_path: string
          title: string
          worktree_branch: string | null
          worktree_path: string | null
          payload_json: string
          created_at: string
          updated_at: string
          archived_at: string | null
        }
      | undefined
    if (!row) return null
    return this.mapProjectSession(row)
  }

  createProjectSession(input: {
    machine: string
    projectPath: string
    cwdPath: string
    title: string
    worktreeBranch?: string | null
    worktreePath?: string | null
    payload?: ProjectSessionPayload
  }): ProjectSession {
    const machine = input.machine.trim()
    if (!machine) throw new Error("invalid project session machine")
    const projectPath = this.canonicalizeRootPath(input.projectPath)
    const cwdPath = this.canonicalizeRootPath(input.cwdPath)
    const title = input.title.trim() || "Session"
    const payload = tryDecodeProjectSessionPayload(
      input.payload ?? emptyProjectSessionPayload(),
    )
    if (!payload) throw new Error("invalid project session payload")
    const id = `ses-${randomUUID()}`
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO project_sessions(
           id, machine, project_path, cwd_path, title,
           worktree_branch, worktree_path, payload_json,
           created_at, updated_at, archived_at
         ) VALUES(?,?,?,?,?,?,?,?,?,?,NULL)`,
      )
      .run(
        id,
        machine,
        projectPath,
        cwdPath,
        title,
        input.worktreeBranch ?? null,
        input.worktreePath ?? null,
        JSON.stringify(this.normalizePayload(payload)),
        now,
        now,
      )
    const created = this.getProjectSession(id)
    if (!created) throw new Error("failed to create project session")
    return created
  }

  updateProjectSessionPayload(
    id: string,
    payload: ProjectSessionPayload,
  ): ProjectSession {
    const normalized = tryDecodeProjectSessionPayload(payload)
    if (!normalized) throw new Error("invalid project session payload")
    const existing = this.getProjectSession(id)
    if (!existing) throw new Error("project session not found")
    const now = new Date().toISOString()
    this.db
      .prepare(
        `UPDATE project_sessions
            SET payload_json=?, updated_at=?
          WHERE id=?`,
      )
      .run(JSON.stringify(this.normalizePayload(normalized)), now, id)
    const updated = this.getProjectSession(id)
    if (!updated) throw new Error("project session not found")
    return updated
  }

  renameProjectSession(id: string, title: string): ProjectSession {
    const trimmed = title.trim()
    if (!trimmed) throw new Error("invalid project session title")
    const existing = this.getProjectSession(id)
    if (!existing) throw new Error("project session not found")
    const now = new Date().toISOString()
    this.db
      .prepare(
        `UPDATE project_sessions SET title=?, updated_at=? WHERE id=?`,
      )
      .run(trimmed, now, id)
    const updated = this.getProjectSession(id)
    if (!updated) throw new Error("project session not found")
    return updated
  }

  touchProjectSession(id: string): ProjectSession {
    const existing = this.getProjectSession(id)
    if (!existing) throw new Error("project session not found")
    const now = new Date().toISOString()
    this.db
      .prepare(`UPDATE project_sessions SET updated_at=? WHERE id=?`)
      .run(now, id)
    const updated = this.getProjectSession(id)
    if (!updated) throw new Error("project session not found")
    return updated
  }

  archiveProjectSession(id: string, archived = true): ProjectSession {
    const existing = this.getProjectSession(id)
    if (!existing) throw new Error("project session not found")
    const now = new Date().toISOString()
    this.db
      .prepare(
        `UPDATE project_sessions
            SET archived_at=?, updated_at=?
          WHERE id=?`,
      )
      .run(archived ? now : null, now, id)
    const updated = this.getProjectSession(id)
    if (!updated) throw new Error("project session not found")
    return updated
  }

  deleteProjectSession(id: string): boolean {
    const result = this.db
      .prepare("DELETE FROM project_sessions WHERE id=?")
      .run(id)
    return Number(result.changes ?? 0) > 0
  }

  private normalizePayload(payload: ProjectSessionPayload): ProjectSessionPayload {
    const sessions = payload.sessions.map(leaf => ({
      ...leaf,
      cwdRootUri: this.canonicalizeCwdUri(leaf.cwdRootUri),
      ...(leaf.liveCwdUri
        ? { liveCwdUri: this.canonicalizeCwdUri(leaf.liveCwdUri) }
        : {}),
    }))
    return {
      version: 1,
      layout: payload.layout,
      sessions,
      ...(payload.gitRoots ? { gitRoots: payload.gitRoots } : {}),
      ...(payload.editorFiles ? { editorFiles: payload.editorFiles } : {}),
    }
  }

  private mapProjectSessionSummary(row: {
    id: string
    machine: string
    project_path: string
    cwd_path: string
    title: string
    worktree_branch: string | null
    worktree_path: string | null
    created_at: string
    updated_at: string
    archived_at: string | null
  }): ProjectSessionSummary {
    return {
      id: row.id,
      machine: row.machine,
      projectPath: row.project_path,
      cwdPath: row.cwd_path,
      title: row.title,
      worktreeBranch: row.worktree_branch,
      worktreePath: row.worktree_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at,
    }
  }

  private mapProjectSession(row: {
    id: string
    machine: string
    project_path: string
    cwd_path: string
    title: string
    worktree_branch: string | null
    worktree_path: string | null
    payload_json: string
    created_at: string
    updated_at: string
    archived_at: string | null
  }): ProjectSession {
    let payload = emptyProjectSessionPayload()
    try {
      const decoded = tryDecodeProjectSessionPayload(JSON.parse(row.payload_json))
      if (decoded) payload = decoded
    } catch {
      /* corrupt payload */
    }
    return {
      ...this.mapProjectSessionSummary(row),
      payload,
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.db.close()
    } catch {
      /* already closed */
    }
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
}
