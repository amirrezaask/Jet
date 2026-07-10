import type { TurnEvent } from "@jet/agents"
import { runStreamJsonCli } from "./shared.js"
import type { AgentDriverRunInput } from "./cursor.js"

export function runClaudeDriver(input: AgentDriverRunInput): Promise<void> {
  const model = input.model.trim() || "claude-sonnet-4-6"
  return runStreamJsonCli({
    command: "claude",
    cwd: input.workspaceRootPath,
    assistantMessageId: input.assistantMessageId,
    signal: input.signal,
    onEvent: input.onEvent,
    args: [
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
      "--dangerously-skip-permissions",
      "--add-dir",
      input.workspaceRootPath,
      "--model",
      model,
      input.prompt,
    ],
  })
}
