import assert from "node:assert/strict"
import test from "node:test"

import type { AgentThread } from "./types.js"
import { deriveTimelineEntriesFromThread } from "./timeline.js"

function thread(overrides: Partial<AgentThread> = {}): AgentThread {
  return {
    id: "thread-1",
    title: "Agent session",
    workspaceRootUri: "file:///workspace",
    workspaceRootPath: "/workspace",
    agentId: "cursor",
    driverId: "cursor:acp",
    model: "auto",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:02.000Z",
    archivedAt: null,
    status: "idle",
    lastError: null,
    messages: [],
    ...overrides,
  }
}

test("ACP transport text and canonical assistant message render once", () => {
  const entries = deriveTimelineEntriesFromThread(
    thread({
      messages: [
        {
          id: "assistant-message",
          role: "assistant",
          text: "Hello! How can I help you today?",
          createdAt: "2026-01-01T00:00:01.000Z",
          updatedAt: "2026-01-01T00:00:02.000Z",
          streaming: false,
        },
      ],
      timeline: [
        {
          id: "transport-text",
          kind: "assistant",
          text: "Hello! How can I help you today?",
          createdAt: "2026-01-01T00:00:02.000Z",
        },
        {
          id: "thought",
          kind: "thought",
          text: "Consider the request.",
          createdAt: "2026-01-01T00:00:01.500Z",
        },
      ],
    }),
  )

  assert.equal(
    entries.filter(entry => entry.kind === "message").length,
    1,
  )
  assert.equal(
    entries.filter(entry => entry.kind === "structured").length,
    1,
  )
})

test("structured-only assistant messages remain visible", () => {
  const entries = deriveTimelineEntriesFromThread(
    thread({
      timeline: [
        {
          id: "structured-only",
          kind: "assistant",
          text: "Imported response",
          createdAt: "2026-01-01T00:00:01.000Z",
        },
      ],
    }),
  )

  assert.equal(entries.length, 1)
  assert.equal(entries[0]?.kind, "message")
})

test("dedupe consumes only one matching transport event per canonical message", () => {
  const entries = deriveTimelineEntriesFromThread(
    thread({
      messages: [
        {
          id: "canonical",
          role: "assistant",
          text: "Repeated response",
          createdAt: "2026-01-01T00:00:01.000Z",
        },
      ],
      timeline: [
        {
          id: "transport-duplicate",
          kind: "assistant",
          text: "Repeated response",
          createdAt: "2026-01-01T00:00:01.500Z",
        },
        {
          id: "structured-second-turn",
          kind: "assistant",
          text: "Repeated response",
          createdAt: "2026-01-01T00:00:03.000Z",
        },
      ],
    }),
  )

  assert.equal(
    entries.filter(entry => entry.kind === "message").length,
    2,
  )
})
