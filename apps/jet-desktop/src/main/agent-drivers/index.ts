import type { TurnEvent } from "@jet/agents"
import { runClaudeDriver } from "./claude.js"
import { runCodexDriver } from "./codex-driver.js"
import type { AgentDriverRunInput } from "./cursor.js"
import { runCursorDriver } from "./cursor.js"
import { runMockDriver } from "./mock.js"

export { runMockDriver } from "./mock.js"
export type { AgentDriverRunInput } from "./cursor.js"

function normalizeProviderId(provider: string | null | undefined): string {
  return (provider ?? "cursor").trim()
}

export function resolveAgentDriver(provider: string | null | undefined): {
  driverKind: string
  run: (input: AgentDriverRunInput) => Promise<void>
} {
  const id = normalizeProviderId(provider)
  if (id === "cursor") {
    return { driverKind: "cursor", run: runCursorDriver }
  }
  if (id === "claudeAgent" || id === "claude") {
    return { driverKind: "claudeAgent", run: runClaudeDriver }
  }
  if (id === "codex") {
    return { driverKind: "codex", run: runCodexDriver }
  }
  throw new Error(`Agent provider "${id}" is not supported yet`)
}

export function shouldUseMockDriver(): boolean {
  return process.env.JET_AGENT_MOCK === "1"
}

export async function runAgentDriverWithFallback(
  provider: string | null | undefined,
  input: AgentDriverRunInput,
): Promise<void> {
  if (shouldUseMockDriver()) {
    await runMockDriver(input)
    return
  }

  try {
    const { run } = resolveAgentDriver(provider)
    await run(input)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const event: TurnEvent = { kind: "turn-error", message }
    input.onEvent(event)
  }
}
