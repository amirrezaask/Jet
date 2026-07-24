//! SQLite-backed agent event store (dual-write path alongside JSON thread files).
//!
//! Schema is the foundation for replacing full-thread JSON rewrites on the
//! streaming hot path. JSON remains authoritative for hydration until migration
//! proves stable.

use anyhow::Context;
use rusqlite::{params, Connection};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct AgentEventStore {
    connection: Mutex<Connection>,
}

impl AgentEventStore {
    pub fn open(path: impl AsRef<Path>) -> anyhow::Result<Self> {
        let connection = Connection::open(path).context("open agent event store")?;
        connection.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);
             INSERT OR IGNORE INTO schema_migrations(version) VALUES(1);
             CREATE TABLE IF NOT EXISTS agent_threads(
               id TEXT PRIMARY KEY,
               workspace_root TEXT NOT NULL,
               title TEXT NOT NULL,
               agent_id TEXT,
               driver_id TEXT,
               status TEXT NOT NULL,
               snapshot_json TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS agent_events(
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               thread_id TEXT NOT NULL,
               sequence INTEGER NOT NULL,
               kind TEXT NOT NULL,
               payload_json TEXT NOT NULL,
               created_at TEXT NOT NULL,
               UNIQUE(thread_id, sequence)
             );
             CREATE INDEX IF NOT EXISTS idx_agent_events_thread
               ON agent_events(thread_id, sequence);
             CREATE TABLE IF NOT EXISTS agent_drafts(
               thread_id TEXT PRIMARY KEY,
               workspace_root TEXT NOT NULL,
               draft_text TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );",
        )?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn default_path(workspace_root: &str) -> PathBuf {
        PathBuf::from(workspace_root)
            .join(".gharargah")
            .join("agents")
            .join("events.sqlite3")
    }

    pub fn upsert_thread_snapshot(&self, thread: &Value) -> anyhow::Result<()> {
        let id = thread
            .get("id")
            .and_then(Value::as_str)
            .context("thread id")?;
        let workspace = thread
            .get("workspaceRootPath")
            .and_then(Value::as_str)
            .unwrap_or("");
        let title = thread
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("New agent");
        let agent_id = thread.get("agentId").and_then(Value::as_str);
        let driver_id = thread.get("driverId").and_then(Value::as_str);
        let status = thread
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("idle");
        let updated_at = thread
            .get("updatedAt")
            .and_then(Value::as_str)
            .unwrap_or("");
        let snapshot = serde_json::to_string(thread)?;
        let conn = self.connection.lock().unwrap();
        conn.execute(
            "INSERT INTO agent_threads(id, workspace_root, title, agent_id, driver_id, status, snapshot_json, updated_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8)
             ON CONFLICT(id) DO UPDATE SET
               workspace_root=excluded.workspace_root,
               title=excluded.title,
               agent_id=excluded.agent_id,
               driver_id=excluded.driver_id,
               status=excluded.status,
               snapshot_json=excluded.snapshot_json,
               updated_at=excluded.updated_at",
            params![
                id,
                workspace,
                title,
                agent_id,
                driver_id,
                status,
                snapshot,
                updated_at
            ],
        )?;
        Ok(())
    }

    pub fn append_event(
        &self,
        thread_id: &str,
        sequence: u64,
        kind: &str,
        payload: &Value,
    ) -> anyhow::Result<()> {
        let created_at = chrono::Utc::now().to_rfc3339();
        let payload_json = serde_json::to_string(payload)?;
        let conn = self.connection.lock().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO agent_events(thread_id, sequence, kind, payload_json, created_at)
             VALUES(?1,?2,?3,?4,?5)",
            params![thread_id, sequence as i64, kind, payload_json, created_at],
        )?;
        Ok(())
    }

    pub fn load_snapshot(&self, thread_id: &str) -> anyhow::Result<Option<Value>> {
        let conn = self.connection.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT snapshot_json FROM agent_threads WHERE id=?1")?;
        let mut rows = stmt.query(params![thread_id])?;
        if let Some(row) = rows.next()? {
            let raw: String = row.get(0)?;
            Ok(Some(serde_json::from_str(&raw)?))
        } else {
            Ok(None)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn dual_write_roundtrip() {
        let dir = TempDir::new().unwrap();
        let store = AgentEventStore::open(dir.path().join("events.sqlite3")).unwrap();
        let thread = serde_json::json!({
            "id": "t1",
            "title": "Hello",
            "workspaceRootPath": "/tmp/ws",
            "agentId": "cursor",
            "driverId": "cursor:acp",
            "status": "idle",
            "updatedAt": "2026-01-01T00:00:00Z",
        });
        store.upsert_thread_snapshot(&thread).unwrap();
        store
            .append_event("t1", 1, "assistant_delta", &serde_json::json!({"text": "hi"}))
            .unwrap();
        let loaded = store.load_snapshot("t1").unwrap().unwrap();
        assert_eq!(loaded["title"], "Hello");
    }
}
