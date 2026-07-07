import { runMockTurn } from "@jet/agents"
import type { AgentDriverRunInput } from "./cursor.js"

export function runMockDriver(input: AgentDriverRunInput): Promise<void> {
  return runMockTurn({
    assistantMessageId: input.assistantMessageId,
    prompt: input.prompt,
    signal: input.signal,
    onEvent: input.onEvent,
  })
}
