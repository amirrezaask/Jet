import type { AgentProvider } from "@gharargah/shared"
import {
  notificationLaunchForProvider,
  type ProviderNotificationLaunchContext,
} from "./hooks/notification-provider-launch.js"
import type { TerminalSessionStatus } from "./tabs/terminal-session.js"

const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i

/** Provider-native CLI session id (Codex thread, Claude session, etc.). */
export function agentCliCommandForProvider(provider: AgentProvider): string {
  switch (provider) {
    case "cursor":
      return "cursor-agent"
    default:
      return provider
  }
}

export function mergeAgentCliResumeArgs(
  provider: AgentProvider,
  notifyArgs: string[],
  cliSessionId: string,
): string[] {
  const id = cliSessionId.trim()
  if (!id) return notifyArgs
  switch (provider) {
    case "codex":
      return ["resume", id, ...notifyArgs]
    case "claude":
      return ["--resume", id, ...notifyArgs]
    case "cursor":
      return ["--resume", id, ...notifyArgs]
    case "opencode":
      return ["--session", id, ...notifyArgs]
    case "grok":
      return ["--resume", id, ...notifyArgs]
    default:
      return notifyArgs
  }
}

export function buildAgentCliLaunchArgs(
  provider: AgentProvider,
  context: ProviderNotificationLaunchContext,
  cliSessionId?: string | null,
): string[] {
  const command = agentCliCommandForProvider(provider)
  const notifyArgs = notificationLaunchForProvider(provider, command, context).args
  if (!cliSessionId) return notifyArgs
  return mergeAgentCliResumeArgs(provider, notifyArgs, cliSessionId)
}

export function tryParseAgentCliSessionId(
  provider: AgentProvider | undefined,
  chunk: string,
): string | null {
  if (!provider || !chunk) return null
  const uuid = chunk.match(UUID_RE)?.[0]
  if (!uuid) return null

  if (provider === "claude") {
    if (/session[_ -]?id/i.test(chunk)) return uuid
    return null
  }
  if (provider === "codex") {
    if (/session/i.test(chunk)) return uuid
    return null
  }
  if (provider === "opencode") {
    if (/session/i.test(chunk)) return uuid
    return null
  }
  if (provider === "cursor" || provider === "grok") {
    return uuid
  }
  return null
}

export function syncAgentCliLaunchArgs(
  tabId: string,
  provider: AgentProvider,
  cliSessionId?: string | null,
  origin = typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:4747",
): string[] {
  return buildAgentCliLaunchArgs(
    provider,
    { sessionId: tabId, origin },
    cliSessionId,
  )
}

export function captureAgentCliSessionFromNotification(
  tabId: string,
  provider: AgentProvider | null | undefined,
  providerSessionId: string | null | undefined,
  setId: (tabId: string, id: string) => void,
): void {
  if (!provider || !isAgentCliProvider(provider)) return
  const id = providerSessionId?.trim()
  if (!id) return
  setId(tabId, id)
}

export function captureAgentCliSessionFromOutput(
  tabId: string,
  provider: AgentProvider | undefined,
  chunk: string,
  setId: (tabId: string, id: string) => void,
): void {
  const parsed = tryParseAgentCliSessionId(provider, chunk)
  if (parsed) setId(tabId, parsed)
}

export type HydratedAgentCliFields = {
  launchCommand?: string
  launchArgs?: string[]
  ptyId?: string
  status: TerminalSessionStatus
}

export function prepareHydratedAgentCliFields(input: {
  tabId: string
  agentId?: string
  agentCliSessionId?: string
  launchCommand?: string
  launchArgs?: string[]
  status: TerminalSessionStatus
  doneAt?: string
  origin?: string
}): HydratedAgentCliFields {
  const origin =
    input.origin ??
    (typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:4747")
  if (input.doneAt) {
    return {
      launchCommand: input.launchCommand,
      launchArgs: input.launchArgs,
      ptyId: undefined,
      status: "exited",
    }
  }
  if (!input.agentCliSessionId || !isAgentCliProvider(input.agentId)) {
    return {
      launchCommand: input.launchCommand,
      launchArgs: input.launchArgs,
      ptyId: undefined,
      status:
        input.status === "running" || input.status === "starting"
          ? "starting"
          : input.status,
    }
  }
  const provider = input.agentId
  return {
    launchCommand: input.launchCommand ?? agentCliCommandForProvider(provider),
    launchArgs: syncAgentCliLaunchArgs(input.tabId, provider, input.agentCliSessionId, origin),
    ptyId: undefined,
    status: "starting",
  }
}

export function isAgentCliProvider(
  value: string | undefined | null,
): value is AgentProvider {
  return (
    value === "codex" ||
    value === "claude" ||
    value === "opencode" ||
    value === "cursor" ||
    value === "grok"
  )
}

/** Only agent CLI home sessions are written to the session roster. */
export function isPersistableAgentSession(session: {
  agentId?: string
  launchCommand?: string
  parentSessionTabId?: string
}): boolean {
  if (session.parentSessionTabId) return false
  if (!session.agentId || !isAgentCliProvider(session.agentId)) return false
  return Boolean(session.launchCommand?.trim())
}
