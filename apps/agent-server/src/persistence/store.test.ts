import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { AgentStore } from "./store.js"

function makeLegacyRustDb(dbFile: string): void {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true })
  const db = new DatabaseSync(dbFile)
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
    makeLegacyRustDb(path.join(root, ".gharargah", "agents", "events.sqlite3"))
    const store = new AgentStore()
    try {
      store.putReceipt(root, "new-1", "t1", { ok: true })
      assert.deepEqual(store.getReceipt(root, "old-1"), { ok: true })
      assert.deepEqual(store.getReceipt(root, "new-1"), { ok: true })
    } finally {
      store.close()
    }
  })
})

describe("AgentStore crash recovery", () => {
  function runningThread(id: string) {
    return {
      id,
      workspaceRootUri: "file:///tmp/x",
      workspaceRootPath: "/tmp/x",
      title: id,
      status: "running" as const,
      messages: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }
  }

  it("marks a thread orphaned by a host restart as interrupted", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gharargah-recover-"))
    const store = new AgentStore()
    try {
      store.writeThread(root, runningThread("orphan") as never)
      const listed = store.listThreads(root)
      assert.equal(listed.find(t => t.id === "orphan")?.status, "interrupted")
    } finally {
      store.close()
    }
  })

  it("leaves a turn this process is still driving alone", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gharargah-recover-live-"))
    const store = new AgentStore()
    try {
      store.writeThread(root, runningThread("live") as never)
      // Listing threads mid-turn must not cancel the turn out from under the UI.
      store.isThreadLive = id => id === "live"
      const listed = store.listThreads(root)
      assert.equal(listed.find(t => t.id === "live")?.status, "running")
      assert.equal(store.readThread(root, "live")?.status, "running")
    } finally {
      store.close()
    }
  })
})
