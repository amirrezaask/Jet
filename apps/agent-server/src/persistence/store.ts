import { DatabaseSync } from "node:sqlite"
import fs from "node:fs"
import path from "node:path"
import type { AgentThread, AgentThreadSummary } from "@gharargah/agents"
import { summarizeThread } from "@gharargah/agents"

function agentsDir(rootPath: string): string {
  return path.join(rootPath, ".gharargah", "agents")
}

function threadsDir(rootPath: string): string {
  return path.join(agentsDir(rootPath), "threads")
}

function ensureDirs(rootPath: string): void {
  fs.mkdirSync(threadsDir(rootPath), { recursive: true })
}

function dbPath(rootPath: string): string {
  return path.join(agentsDir(rootPath), "events.sqlite3")
}

function tableColumns(db: DatabaseSync, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return new Set(rows.map(r => r.name))
}

function tableExists(db: DatabaseSync, table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table) as { name: string } | undefined
  return Boolean(row)
}

/**
 * Migrate Rust AgentsHost SQLite schema → Effect agent-server schema.
 * CREATE TABLE IF NOT EXISTS never alters existing tables, so a workspace that
 * previously ran the Rust agents path keeps `kind`/`status` NOT NULL and breaks
 * Effect inserts (`NOT NULL constraint failed: agent_command_receipts.kind`).
 */
function migrateLegacySchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);
  `)

  // --- agent_command_receipts ---
  if (tableExists(db, "agent_command_receipts")) {
    const cols = tableColumns(db, "agent_command_receipts")
    if (cols.has("kind") || cols.has("status")) {
      db.exec(`
        BEGIN;
        CREATE TABLE agent_command_receipts_effect (
          command_id TEXT PRIMARY KEY,
          thread_id TEXT,
          result_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        INSERT INTO agent_command_receipts_effect (command_id, thread_id, result_json, created_at)
          SELECT
            command_id,
            thread_id,
            COALESCE(result_json, 'null'),
            COALESCE(created_at, datetime('now'))
          FROM agent_command_receipts;
        DROP TABLE agent_command_receipts;
        ALTER TABLE agent_command_receipts_effect RENAME TO agent_command_receipts;
        COMMIT;
      `)
    }
  }

  // --- agent_events (Rust: sequence/kind/payload_json → Effect: seq/event_json) ---
  if (tableExists(db, "agent_events")) {
    const cols = tableColumns(db, "agent_events")
    if (cols.has("sequence") || cols.has("payload_json") || cols.has("kind")) {
      db.exec(`
        BEGIN;
        CREATE TABLE agent_events_effect (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          thread_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          event_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        INSERT INTO agent_events_effect (thread_id, seq, event_json, created_at)
          SELECT
            thread_id,
            COALESCE(sequence, 0),
            COALESCE(payload_json, '{}'),
            COALESCE(created_at, datetime('now'))
          FROM agent_events;
        DROP TABLE agent_events;
        ALTER TABLE agent_events_effect RENAME TO agent_events;
        COMMIT;
      `)
    }
  }

  db.prepare(`INSERT OR IGNORE INTO schema_migrations(version) VALUES(2)`).run()
}

export class AgentStore {
  private dbs = new Map<string, DatabaseSync>()

  private db(rootPath: string): DatabaseSync {
    const key = path.resolve(rootPath)
    let db = this.dbs.get(key)
    if (db) return db
    ensureDirs(key)
    db = new DatabaseSync(dbPath(key))
    db.exec("PRAGMA journal_mode = WAL")
    // Migrate legacy Rust tables BEFORE CREATE IF NOT EXISTS so we don't leave
    // incompatible NOT NULL columns in place.
    migrateLegacySchema(db)
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_command_receipts (
        command_id TEXT PRIMARY KEY,
        thread_id TEXT,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        event_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS provider_sessions (
        thread_id TEXT PRIMARY KEY,
        instance_id TEXT,
        resume_cursor TEXT,
        transport TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS thread_snapshots (
        thread_id TEXT PRIMARY KEY,
        snapshot_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
    this.dbs.set(key, db)
    return db
  }

  getReceipt(rootPath: string, commandId: string): unknown | null {
    const row = this.db(rootPath)
      .prepare("SELECT result_json FROM agent_command_receipts WHERE command_id = ?")
      .get(commandId) as { result_json: string } | undefined
    if (!row) return null
    return JSON.parse(row.result_json) as unknown
  }

  putReceipt(
    rootPath: string,
    commandId: string,
    threadId: string | null,
    result: unknown,
  ): void {
    this.db(rootPath)
      .prepare(
        `INSERT OR REPLACE INTO agent_command_receipts (command_id, thread_id, result_json, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(commandId, threadId, JSON.stringify(result ?? null), new Date().toISOString())
  }

  appendEvent(rootPath: string, threadId: string, seq: number, event: unknown): void {
    this.db(rootPath)
      .prepare(
        `INSERT INTO agent_events (thread_id, seq, event_json, created_at) VALUES (?, ?, ?, ?)`,
      )
      .run(threadId, seq, JSON.stringify(event), new Date().toISOString())
  }

  saveProviderSession(
    rootPath: string,
    threadId: string,
    input: { instanceId?: string; resumeCursor?: unknown; transport?: string },
  ): void {
    this.db(rootPath)
      .prepare(
        `INSERT OR REPLACE INTO provider_sessions (thread_id, instance_id, resume_cursor, transport, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        threadId,
        input.instanceId ?? null,
        input.resumeCursor ? JSON.stringify(input.resumeCursor) : null,
        input.transport ?? null,
        new Date().toISOString(),
      )
  }

  /** SQLite is source of truth; JSON files are a compatibility projection. */
  writeThread(rootPath: string, thread: AgentThread): void {
    ensureDirs(rootPath)
    const now = new Date().toISOString()
    this.db(rootPath)
      .prepare(
        `INSERT OR REPLACE INTO thread_snapshots (thread_id, snapshot_json, updated_at) VALUES (?, ?, ?)`,
      )
      .run(thread.id, JSON.stringify(thread), now)
    const file = path.join(threadsDir(rootPath), `${thread.id}.json`)
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(thread, null, 2))
    fs.renameSync(tmp, file)
    this.writeIndex(rootPath)
  }

  readThread(rootPath: string, threadId: string): AgentThread | null {
    const row = this.db(rootPath)
      .prepare("SELECT snapshot_json FROM thread_snapshots WHERE thread_id = ?")
      .get(threadId) as { snapshot_json: string } | undefined
    if (row) return JSON.parse(row.snapshot_json) as AgentThread
    const file = path.join(threadsDir(rootPath), `${threadId}.json`)
    if (!fs.existsSync(file)) return null
    const thread = JSON.parse(fs.readFileSync(file, "utf8")) as AgentThread
    this.writeThread(rootPath, thread)
    return thread
  }

  listThreads(rootPath: string): AgentThreadSummary[] {
    ensureDirs(rootPath)
    const rows = this.db(rootPath)
      .prepare("SELECT snapshot_json FROM thread_snapshots")
      .all() as Array<{ snapshot_json: string }>
    let threads = rows.map(r => JSON.parse(r.snapshot_json) as AgentThread)
    if (threads.length === 0) {
      const dir = threadsDir(rootPath)
      if (fs.existsSync(dir)) {
        for (const name of fs.readdirSync(dir)) {
          if (!name.endsWith(".json")) continue
          try {
            const t = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as AgentThread
            threads.push(t)
            this.writeThread(rootPath, t)
          } catch {
            /* skip corrupt */
          }
        }
      }
    }
    // Crash recovery: orphan running → interrupted
    for (const t of threads) {
      if (
        t.status === "running" ||
        t.status === "connecting" ||
        t.status === "cancelling" ||
        t.status === "waiting_for_permission"
      ) {
        const fixed = {
          ...t,
          status: "interrupted" as const,
          lastError: t.lastError ?? "Recovered after host restart",
          updatedAt: new Date().toISOString(),
        }
        this.writeThread(rootPath, fixed)
        Object.assign(t, fixed)
      }
    }
    return threads.map(summarizeThread).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  private writeIndex(rootPath: string): void {
    const summaries = this.listThreadsNoRecover(rootPath)
    const indexPath = path.join(agentsDir(rootPath), "index.json")
    const tmp = `${indexPath}.tmp`
    fs.writeFileSync(
      tmp,
      JSON.stringify({ threads: summaries, updatedAt: new Date().toISOString() }, null, 2),
    )
    fs.renameSync(tmp, indexPath)
  }

  private listThreadsNoRecover(rootPath: string): AgentThreadSummary[] {
    const rows = this.db(rootPath)
      .prepare("SELECT snapshot_json FROM thread_snapshots")
      .all() as Array<{ snapshot_json: string }>
    return rows
      .map(r => summarizeThread(JSON.parse(r.snapshot_json) as AgentThread))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  close(): void {
    for (const db of this.dbs.values()) db.close()
    this.dbs.clear()
  }
}
