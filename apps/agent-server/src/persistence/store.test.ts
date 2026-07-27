import { describe, it } from "node:test"
import assert from "node:assert/strict"
import Database from "better-sqlite3"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { AgentStore } from "./store.js"

function makeLegacyRustDb(dbFile: string): void {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true })
  const db = new Database(dbFile)
  db.exec(`
    CREATE TABLE agent_command_receipts(
      command_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      result_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE agent_events(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(thread_id, sequence)
    );
    INSERT INTO agent_command_receipts VALUES
      ('old-1', 't1', 'thread.turn.start', 'ok', '{"ok":true}', '2026-01-01T00:00:00.000Z');
    INSERT INTO agent_events (thread_id, sequence, kind, payload_json, created_at) VALUES
      ('t1', 1, 'content.delta', '{"text":"hi"}', '2026-01-01T00:00:00.000Z');
  `)
  db.close()
}

describe("AgentStore legacy Rust schema migration", () => {
  it("migrates receipts without NOT NULL kind failure", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gharargah-store-"))
    const dbFile = path.join(root, ".gharargah", "agents", "events.sqlite3")
    makeLegacyRustDb(dbFile)

    const store = new AgentStore()
    // Would throw NOT NULL on kind before migration.
    store.putReceipt(root, "new-cmd", "t1", { type: "thread.create", id: "t1" })
    assert.deepEqual(store.getReceipt(root, "new-cmd"), { type: "thread.create", id: "t1" })
    assert.deepEqual(store.getReceipt(root, "old-1"), { ok: true })
    store.appendEvent(root, "t1", 2, { type: "turn.completed" })
    store.close()
  })
})
