import assert from "node:assert/strict"
import test from "node:test"
import type { AgentToolCall } from "@gharargah/agents"
import { fileRefFromToolCall, summarizeToolCall } from "./ToolCallCard.js"

function toolCall(partial: Partial<AgentToolCall> & Pick<AgentToolCall, "id" | "name">): AgentToolCall {
  return {
    status: "completed",
    ...partial,
  }
}

test("summarizeToolCall prefers structured path from JSON input", () => {
  assert.equal(
    summarizeToolCall(
      toolCall({
        id: "1",
        name: "Read",
        input: JSON.stringify({ path: "packages/gharargah-ui/src/index.ts" }),
      }),
    ),
    "packages/gharargah-ui/src/index.ts",
  )
})

test("summarizeToolCall hides summaries that only repeat the tool name", () => {
  assert.equal(
    summarizeToolCall(
      toolCall({
        id: "2",
        name: "Bash",
        summary: "bash",
      }),
    ),
    null,
  )
})

test("summarizeToolCall falls back to raw input text", () => {
  assert.equal(
    summarizeToolCall(
      toolCall({
        id: "3",
        name: "Shell",
        input: "rg useSyncExternalStore packages",
      }),
    ),
    "rg useSyncExternalStore packages",
  )
})

test("fileRefFromToolCall extracts path from JSON input", () => {
  assert.deepEqual(
    fileRefFromToolCall(
      toolCall({
        id: "4",
        name: "Read",
        input: JSON.stringify({ path: "src/index.ts" }),
      }),
    ),
    { path: "src/index.ts" },
  )
})
