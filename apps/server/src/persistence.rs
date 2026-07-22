use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub created_at: String,
    pub updated_at: String,
}

pub struct Database {
    connection: Mutex<Connection>,
}

impl Database {
    pub fn open(path: impl AsRef<Path>) -> anyhow::Result<Self> {
        let connection = Connection::open(path).context("cannot open Jet database")?;
        connection.execute_batch(
            "PRAGMA journal_mode=WAL;
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
               WHERE status IN ('starting','running','waiting');",
        )?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn projects(&self) -> anyhow::Result<Vec<Project>> {
        let connection = self.connection.lock().unwrap();
        let mut stmt = connection.prepare(
            "SELECT id,name,root_path,created_at,updated_at FROM projects ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                root_path: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn project(&self, id: &str) -> anyhow::Result<Option<Project>> {
        let connection = self.connection.lock().unwrap();
        let mut stmt = connection
            .prepare("SELECT id,name,root_path,created_at,updated_at FROM projects WHERE id=?1")?;
        let mut rows = stmt.query([id])?;
        Ok(rows.next()?.map(|row| Project {
            id: row.get(0).unwrap(),
            name: row.get(1).unwrap(),
            root_path: row.get(2).unwrap(),
            created_at: row.get(3).unwrap(),
            updated_at: row.get(4).unwrap(),
        }))
    }

    pub fn add_project(&self, root_path: &Path, name: Option<&str>) -> anyhow::Result<Project> {
        let root_path = root_path.canonicalize()?;
        let root = root_path.to_string_lossy().into_owned();
        let now = chrono::Utc::now().to_rfc3339();
        let id = uuid::Uuid::new_v4().to_string();
        let display_name = name.map(str::to_string).unwrap_or_else(|| {
            root_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned()
        });
        let connection = self.connection.lock().unwrap();
        let existing = connection
            .query_row(
                "SELECT id,name,root_path,created_at,updated_at FROM projects WHERE root_path=?1",
                [&root],
                |row| {
                    Ok(Project {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        root_path: row.get(2)?,
                        created_at: row.get(3)?,
                        updated_at: row.get(4)?,
                    })
                },
            )
            .optional()?;
        if let Some(existing) = existing {
            return Ok(existing);
        }
        connection.execute(
            "INSERT INTO projects(id,name,root_path,created_at,updated_at) VALUES(?1,?2,?3,?4,?4)",
            params![id, display_name, root, now],
        )?;
        Ok(Project {
            id,
            name: display_name,
            root_path: root,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn remove_project(&self, id: &str) -> anyhow::Result<bool> {
        Ok(self
            .connection
            .lock()
            .unwrap()
            .execute("DELETE FROM projects WHERE id=?1", [id])?
            > 0)
    }

    pub fn record_session(
        &self,
        id: &str,
        kind: &str,
        status: &str,
        metadata: &serde_json::Value,
    ) -> anyhow::Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        self.connection.lock().unwrap().execute(
            "INSERT INTO sessions(id,kind,status,metadata_json,created_at,updated_at)
             VALUES(?1,?2,?3,?4,?5,?5)
             ON CONFLICT(id) DO UPDATE SET status=excluded.status, metadata_json=excluded.metadata_json, updated_at=excluded.updated_at",
            params![id, kind, status, metadata.to_string(), now],
        )?;
        Ok(())
    }

    pub fn update_session_status(&self, id: &str, status: &str) -> anyhow::Result<()> {
        self.connection.lock().unwrap().execute(
            "UPDATE sessions SET status=?2, updated_at=?3 WHERE id=?1",
            params![id, status, chrono::Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_database_migrates_and_persists_projects() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(dir.path().join("db.sqlite")).unwrap();
        let project = db.add_project(dir.path(), Some("fixture")).unwrap();
        assert_eq!(db.projects().unwrap(), vec![project.clone()]);
        assert!(db.remove_project(&project.id).unwrap());
        assert!(dir.path().exists());
    }
}
