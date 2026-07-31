import assert from "node:assert/strict"
import test from "node:test"
import type { AgentThread, TimelineEntry } from "@gharargah/agents"
import {
  deriveMessagesTimelineRows,
  deriveTimelineTurnFromThread,
  resolveAssistantMessageCopyState,
  resolveTimelineIsAtEnd,
} from "./MessagesTimeline.logic.js"

test("resolveAssistantMessageCopyState coerces content-block arrays", () => {
  const state = resolveAssistantMessageCopyState({
    text: [{ type: "text", text: "hello", text_elements: [] }],
    showCopyButton: true,
    streaming: false,
  })
  assert.equal(state.text, "hello")
  assert.equal(state.visible, true)
})

test("resolveTimelineIsAtEnd prefers near-end over strict end", () => {
  assert.equal(resolveTimelineIsAtEnd({ isAtEnd: false, isNearEnd: true }), true)
  assert.equal(resolveTimelineIsAtEnd({ isAtEnd: true }), true)
  assert.equal(resolveTimelineIsAtEnd(undefined), undefined)
})

function baseThread(overrides: Partial<AgentThread> = {}): AgentThread {
  return {
    id: "thread-1",
    title: "Agent session",
    workspaceRootUri: "file:///workspace",
    workspaceRootPath: "/workspace",
    agentId: "codex",
    driverId: "codex:app-server",
    model: "auto",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    archivedAt: null,
    status: "idle",
    lastError: null,
    messages: [
      {
        id: "user-1",
        role: "user",
        text: "hello",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        streaming: false,
      },
      {
        id: "assistant-1",
        role: "assistant",
        text: "done",
        createdAt: "2026-01-01T00:00:01.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
        streaming: false,
      },
    ],
    ...overrides,
  }
}

function settledEntries(): TimelineEntry[] {
  return [
    {
      id: "user-1",
      kind: "message",
      createdAt: "2026-01-01T00:00:00.000Z",
      message: {
        id: "user-1",
        role: "user",
        text: "hello",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        streaming: false,
      },
    },
    {
      id: "assistant-1",
      kind: "message",
      createdAt: "2026-01-01T00:00:01.000Z",
      message: {
        id: "assistant-1",
        role: "assistant",
        text: "done",
        createdAt: "2026-01-01T00:00:01.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
        streaming: false,
        turnId: "assistant-1",
      },
    },
  ]
}

function turnStatusRow(
  rows: ReturnType<typeof deriveMessagesTimelineRows>,
): Extract<(typeof rows)[number], { kind: "turn_status" }> | undefined {
  const row = rows.find(candidate => candidate.kind === "turn_status")
  return row?.kind === "turn_status" ? row : undefined
}

test("deriveTimelineTurnFromThread maps thread status to latest turn state", () => {
  assert.equal(deriveTimelineTurnFromThread(baseThread()).latestTurn?.state, "completed")
  assert.equal(
    deriveTimelineTurnFromThread(baseThread({ status: "cancelled" })).latestTurn?.state,
    "cancelled",
  )
  assert.equal(
    deriveTimelineTurnFromThread(baseThread({ status: "error" })).latestTurn?.state,
    "failed",
  )
  assert.equal(
    deriveTimelineTurnFromThread(baseThread({ status: "running" })).latestTurn?.state,
    "running",
  )
  assert.equal(
    deriveTimelineTurnFromThread(baseThread({ status: "running" })).runningTurnId,
    "assistant-1",
  )
})

test("deriveMessagesTimelineRows emits distinct turn status labels", () => {
  const common = {
    timelineEntries: settledEntries(),
    isWorking: false,
    workingLabel: "Working…",
    activeTurnStartedAt: "2026-01-01T00:00:01.000Z",
    turnDiffSummaryByAssistantMessageId: new Map(),
  }

  const completed = turnStatusRow(
    deriveMessagesTimelineRows({
      ...common,
      latestTurn: {
        turnId: "assistant-1",
        state: "completed",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:01.000Z",
      },
    }),
  )
  assert.equal(completed?.status, "completed")
  assert.equal(completed?.label, "Completed")

  const failed = turnStatusRow(
    deriveMessagesTimelineRows({
      ...common,
      latestTurn: {
        turnId: "assistant-1",
        state: "failed",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:01.000Z",
      },
    }),
  )
  assert.equal(failed?.status, "failed")
  assert.equal(failed?.label, "Failed")

  const cancelled = turnStatusRow(
    deriveMessagesTimelineRows({
      ...common,
      latestTurn: {
        turnId: "assistant-1",
        state: "cancelled",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:01.000Z",
      },
    }),
  )
  assert.equal(cancelled?.status, "cancelled")
  assert.equal(cancelled?.label, "Cancelled")

  const runningRows = deriveMessagesTimelineRows({
    ...common,
    isWorking: true,
    latestTurn: {
      turnId: "assistant-1",
      state: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
    },
    runningTurnId: "assistant-1",
  })
  assert.equal(turnStatusRow(runningRows), undefined)
  assert.equal(runningRows.some(row => row.kind === "working"), true)
})
