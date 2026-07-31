import assert from "node:assert/strict"
import test from "node:test"
import type { AgentThread } from "./types.js"
import {
  applyAgentStructuredDelta,
  applyAgentThreadDelta,
  mergeAgentThreadSnapshot,
} from "./thread-reducer.js"

function thread(overrides: Partial<AgentThread> = {}): AgentThread {
  return {
    id: "thread-1",
    title: "Agent session",
    workspaceRootUri: "file:///workspace",
    workspaceRootPath: "/workspace",
    agentId: "codex",
    driverId: "codex:app-server",
    model: "auto",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    status: "idle",
    lastError: null,
    messages: [],
    ...overrides,
  }
}

test("a late full snapshot cannot roll back a structured sequence", () => {
  const current = thread({
    updatedAt: "2026-01-01T00:00:02.000Z",
    acpSequence: 4,
    status: "waiting_for_permission",
  })
  const stale = thread({
    updatedAt: "2026-01-01T00:00:03.000Z",
    acpSequence: 3,
    status: "running",
  })
  assert.equal(mergeAgentThreadSnapshot(current, stale), current)
})

test("a late streaming delta cannot revive a completed turn", () => {
  const current = thread({
    updatedAt: "2026-01-01T00:00:03.000Z",
    status: "idle",
    messages: [
      {
        id: "assistant-1",
        role: "assistant",
        text: "done",
        createdAt: "2026-01-01T00:00:01.000Z",
        updatedAt: "2026-01-01T00:00:03.000Z",
        streaming: false,
      },
    ],
  })
  const result = applyAgentThreadDelta(current, {
    workspaceRootUri: current.workspaceRootUri,
    threadId: current.id,
    updatedAt: "2026-01-01T00:00:02.000Z",
    status: "running",
    lastError: null,
    messageId: "assistant-1",
    text: "partial",
    streaming: true,
  })
  assert.equal(result, current)
})

test("an older streaming delta cannot rewind assistant text", () => {
  const current = thread({
    updatedAt: "2026-01-01T00:00:03.000Z",
    status: "running",
    messages: [
      {
        id: "assistant-1",
        role: "assistant",
        text: "longer partial",
        createdAt: "2026-01-01T00:00:01.000Z",
        updatedAt: "2026-01-01T00:00:03.000Z",
        streaming: true,
      },
    ],
  })
  const result = applyAgentThreadDelta(current, {
    workspaceRootUri: current.workspaceRootUri,
    threadId: current.id,
    updatedAt: "2026-01-01T00:00:02.000Z",
    status: "running",
    lastError: null,
    messageId: "assistant-1",
    text: "short",
    streaming: true,
  })
  assert.equal(result, current)
  assert.equal(result?.messages[0]?.text, "longer partial")
})

test("text delta creates the assistant placeholder when events race", () => {
  const result = applyAgentThreadDelta(thread({ status: "running" }), {
    workspaceRootUri: "file:///workspace",
    threadId: "thread-1",
    updatedAt: "2026-01-01T00:00:01.000Z",
    status: "running",
    lastError: null,
    messageId: "assistant-1",
    text: "hello",
    streaming: true,
  })
  assert.equal(result?.messages[0]?.text, "hello")
  assert.equal(result?.messages[0]?.role, "assistant")
})

test("structured deltas are idempotent and update timeline items in place", () => {
  const current = thread({
    acpSequence: 1,
    timeline: [
      {
        id: "tool-1",
        kind: "tool_call",
        createdAt: "2026-01-01T00:00:01.000Z",
        toolCall: { id: "tool-1", name: "Read", status: "running" },
      },
    ],
  })
  const delta = {
    workspaceRootUri: current.workspaceRootUri,
    threadId: current.id,
    sequence: 2,
    updatedAt: "2026-01-01T00:00:02.000Z",
    status: "running" as const,
    updated: [
      {
        id: "tool-1",
        kind: "tool_call" as const,
        createdAt: "2026-01-01T00:00:01.000Z",
        toolCall: { id: "tool-1", name: "Read", status: "completed" as const },
      },
    ],
  }
  const applied = applyAgentStructuredDelta(current, delta)
  assert.equal(applied?.timeline?.length, 1)
  assert.equal(
    applied?.timeline?.[0]?.kind === "tool_call"
      ? applied.timeline[0].toolCall.status
      : null,
    "completed",
  )
  assert.equal(applyAgentStructuredDelta(applied, delta), applied)
})
