import assert from "node:assert/strict"
import test from "node:test"
import {
  aggregateToolCalls,
  classifyToolCall,
  countActivityBuckets,
  formatActivitySummary,
} from "./activityAggregation.js"
import { deriveMessagesTimelineRows } from "./MessagesTimeline.logic.js"
import type { AgentToolCall, TimelineEntry } from "@gharargah/agents"

function tool(
  partial: Partial<AgentToolCall> & Pick<AgentToolCall, "id" | "name">,
): AgentToolCall {
  return {
    status: "completed",
    ...partial,
  }
}

test("classifyToolCall buckets by kind/name", () => {
  assert.equal(classifyToolCall(tool({ id: "1", name: "Shell", kind: "shell" })), "command")
  assert.equal(classifyToolCall(tool({ id: "2", name: "Read", kind: "read" })), "file")
  assert.equal(classifyToolCall(tool({ id: "3", name: "Grep", kind: "search" })), "search")
  assert.equal(classifyToolCall(tool({ id: "4", name: "Write", kind: "edit" })), "edit")
})

test("formatActivitySummary matches Cursor phrasing", () => {
  assert.equal(
    formatActivitySummary({ commands: 1, files: 0, searches: 0, edits: 0, other: 0 }),
    "Ran 1 command",
  )
  assert.equal(
    formatActivitySummary({ commands: 5, files: 9, searches: 6, edits: 0, other: 0 }),
    "Explored 9 files, 6 searches, ran 5 commands",
  )
  assert.equal(
    formatActivitySummary({ commands: 0, files: 0, searches: 0, edits: 4, other: 0 }),
    "Edited 4 files",
  )
})

test("aggregateToolCalls attaches diff stats", () => {
  const aggregated = aggregateToolCalls({
    id: "a1",
    createdAt: "2026-01-01T00:00:00.000Z",
    toolCalls: [
      tool({ id: "t1", name: "Write", kind: "edit" }),
      tool({ id: "t2", name: "Write", kind: "edit" }),
    ],
    turnDiffSummary: {
      turnId: "turn",
      completedAt: "2026-01-01T00:00:01.000Z",
      files: [
        { path: "a.ts", additions: 10, deletions: 2 },
        { path: "b.ts", additions: 5, deletions: 1 },
      ],
    },
  })
  assert.ok(aggregated)
  assert.equal(aggregated!.editFileCount, 2)
  assert.deepEqual(aggregated!.diffStat, { additions: 15, deletions: 3 })
  assert.match(aggregated!.label, /Edited 2 files/)
})

test("countActivityBuckets counts mixed tools", () => {
  assert.deepEqual(
    countActivityBuckets([
      tool({ id: "1", name: "Shell", kind: "shell" }),
      tool({ id: "2", name: "Read", kind: "read" }),
      tool({ id: "3", name: "Grep", kind: "search" }),
    ]),
    { commands: 1, files: 1, searches: 1, edits: 0, other: 0 },
  )
})

test("deriveMessagesTimelineRows aggregates tools and emits Completed", () => {
  const entries: TimelineEntry[] = [
    {
      id: "u1",
      kind: "message",
      createdAt: "2026-01-01T00:00:00.000Z",
      message: {
        id: "u1",
        role: "user",
        text: "speed up compile",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        streaming: false,
      },
    },
    {
      id: "t1",
      kind: "structured",
      createdAt: "2026-01-01T00:00:01.000Z",
      item: {
        id: "t1",
        kind: "tool_call",
        createdAt: "2026-01-01T00:00:01.000Z",
        toolCall: tool({ id: "tc1", name: "Shell", kind: "shell" }),
      },
    },
    {
      id: "t2",
      kind: "structured",
      createdAt: "2026-01-01T00:00:02.000Z",
      item: {
        id: "t2",
        kind: "tool_call",
        createdAt: "2026-01-01T00:00:02.000Z",
        toolCall: tool({ id: "tc2", name: "Read", kind: "read" }),
      },
    },
    {
      id: "a1",
      kind: "message",
      createdAt: "2026-01-01T00:00:03.000Z",
      message: {
        id: "a1",
        role: "assistant",
        text: "Checking LTO settings.",
        createdAt: "2026-01-01T00:00:03.000Z",
        updatedAt: "2026-01-01T00:00:03.000Z",
        streaming: false,
      },
    },
  ]

  const rows = deriveMessagesTimelineRows({
    timelineEntries: entries,
    isWorking: false,
    workingLabel: "Working…",
    activeTurnStartedAt: null,
    turnDiffSummaryByAssistantMessageId: new Map(),
  })

  assert.equal(rows[0]?.kind, "message")
  assert.equal(rows[1]?.kind, "turn_status")
  if (rows[1]?.kind === "turn_status") {
    assert.equal(rows[1].label, "Completed")
  }
  const activity = rows.find(row => row.kind === "activity_group")
  assert.ok(activity)
  if (activity?.kind === "activity_group") {
    assert.match(activity.label, /Ran 1 command|Explored 1 file/)
    assert.equal(activity.toolCalls.length, 2)
  }
  assert.equal(rows.some(row => row.kind === "structured" && row.item.kind === "tool_call"), false)
})
