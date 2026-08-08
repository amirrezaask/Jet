import assert from "node:assert/strict"
import { test } from "node:test"

import {
  runLspSaveSequence,
  staticSaveSyncOptions,
  type LspSaveParticipant,
} from "./save-sequence.js"

test("save sequence applies wait-until edits before one durable write and didSave", async () => {
  const events: string[] = []
  let content = "before"
  const participant: LspSaveParticipant = {
    sync: { willSave: true, willSaveWaitUntil: true, didSave: true, includeText: true },
    notify: async (method, params) => {
      events.push(`${method}:${JSON.stringify(params)}`)
    },
    request: async <R>(method: string) => {
      events.push(method)
      return [{
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 6 },
        },
        newText: "after",
      }] as R
    },
  }

  await runLspSaveSequence({
    uri: "file:///workspace/file.ts",
    reason: 1,
    participants: [participant],
    applyEdits: edits => {
      assert.equal(edits[0]?.newText, "after")
      content = "after"
      events.push("apply")
    },
    getContent: () => content,
    persist: async text => {
      assert.equal(text, "after")
      events.push("persist")
    },
  })

  assert.deepEqual(events.map(event => event.split(":")[0]), [
    "textDocument/willSave",
    "textDocument/willSaveWaitUntil",
    "apply",
    "persist",
    "textDocument/didSave",
  ])
  assert.match(events.at(-1)!, /"text":"after"/)
})

test("failed persistence never emits didSave", async () => {
  const notifications: string[] = []
  await assert.rejects(runLspSaveSequence({
    uri: "file:///workspace/file.ts",
    reason: 1,
    participants: [{
      sync: { willSave: false, willSaveWaitUntil: false, didSave: true, includeText: false },
      notify: async method => { notifications.push(method) },
      request: async <R>() => null as R,
    }],
    applyEdits: () => {},
    getContent: () => "text",
    persist: async () => { throw new Error("disk full") },
  }), /disk full/)
  assert.deepEqual(notifications, [])
})

test("protocol failures and wait-until timeouts never block or retroactively fail persistence", async () => {
  const events: string[] = []
  await runLspSaveSequence({
    uri: "file:///workspace/file.ts",
    reason: 1,
    participants: [{
      sync: { willSave: true, willSaveWaitUntil: true, didSave: true, includeText: false },
      notify: async method => {
        events.push(method)
        throw new Error("transport closed")
      },
      request: async <R>() => new Promise<R>(() => {}),
    }],
    applyEdits: () => { throw new Error("invalid server edit") },
    getContent: () => "saved",
    persist: async () => { events.push("persist") },
    willSaveWaitUntilTimeoutMs: 5,
  })
  assert.deepEqual(events, ["textDocument/willSave", "persist", "textDocument/didSave"])
})

test("derives save synchronization and includeText from server capabilities", () => {
  assert.deepEqual(staticSaveSyncOptions({
    textDocumentSync: {
      openClose: true,
      change: 2,
      willSave: true,
      willSaveWaitUntil: true,
      save: { includeText: true },
    },
  }), {
    willSave: true,
    willSaveWaitUntil: true,
    didSave: true,
    includeText: true,
  })
  assert.equal(staticSaveSyncOptions({ textDocumentSync: 2 }).didSave, false)
})
