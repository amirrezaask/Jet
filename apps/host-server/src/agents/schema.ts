import type { DatabaseSync } from "node:sqlite"

/** Migration version 5 — ADE agent events + session snapshots. */
export function ensureAgentTelemetrySchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      kind TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      native_session_id TEXT,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_events_session_occurred
      ON agent_events(session_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_agent_events_session_kind
      ON agent_events(session_id, kind);

    CREATE TABLE IF NOT EXISTS agent_session_snapshots (
      session_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      native_session_id TEXT,
      snapshot_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `)
  try {
    db.prepare("INSERT OR IGNORE INTO schema_migrations(version) VALUES(5)").run()
  } catch {
    /* migrations table may already have the row */
  }
}
