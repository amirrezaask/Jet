import type { TurnEvent } from "@jet/agents"
import { runCodexJsonCli } from "./codex.js"
import type { AgentDriverRunInput } from "./cursor.js"

export function runCodexDriver(input: AgentDriverRunInput): Promise<void> {
  const model = input.model.trim() || "gpt-5"
  return runCodexJsonCli({
    command: "codex",
    cwd: input.workspaceRootPath,
    assistantMessageId: input.assistantMessageId,
    signal: input.signal,
    onEvent: input.onEvent,
    args: [
      "exec",
      "--json",
      "-C",
      input.workspaceRootPath,
      "-m",
      model,
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      input.prompt,
    ],
  })
}
