import { DatabaseSync } from "node:sqlite"
import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"

export type Project = {
  id: string
  name: string
  rootPath: string
  createdAt: string
  updatedAt: string
}

type ProjectRow = {
  id: string
  name: string
  root_path: string
  created_at: string
  updated_at: string
}

export class ProjectDatabase {
  private readonly db: DatabaseSync

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

  close(): void {
    this.db.close()
  }
}
