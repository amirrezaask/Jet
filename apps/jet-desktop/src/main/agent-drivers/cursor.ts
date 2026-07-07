import type { TurnEvent } from "@jet/agents"
import { resolveBinary, runStreamJsonCli } from "./shared.js"

export type AgentDriverRunInput = {
  workspaceRootPath: string
  model: string
  prompt: string
  assistantMessageId: string
  signal: AbortSignal
  onEvent: (event: TurnEvent) => void
}

export function runCursorDriver(input: AgentDriverRunInput): Promise<void> {
  const command = resolveBinary(["cursor-agent", "agent"])
  const model = input.model.trim() || "auto"
  return runStreamJsonCli({
    command,
    cwd: input.workspaceRootPath,
    assistantMessageId: input.assistantMessageId,
    signal: input.signal,
    onEvent: input.onEvent,
    args: [
      "--print",
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      "--model",
      model,
      "-f",
      input.prompt,
    ],
  })
}
