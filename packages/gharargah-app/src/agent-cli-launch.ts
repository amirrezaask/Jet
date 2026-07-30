import type { AgentProvider } from "@gharargah/shared"
import {
  notificationLaunchForProvider,
  type ProviderNotificationLaunchContext,
} from "./hooks/notification-provider-launch.js"
import type { TerminalSessionStatus } from "./effect/session-machine.js"

const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i
/** OpenCode session ids look like `ses_…`, not UUIDs. */
const OPENCODE_SESSION_RE = /\b(ses_[A-Za-z0-9]+)\b/
const CLAUDE_SESSION_RE =
  /session[_ -]?id[=:\s]+([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i

/** Provider-native CLI session id (Codex thread, Claude session, etc.). */
export function agentCliCommandForProvider(provider: AgentProvider): string {
  switch (provider) {
    case "cursor":
      return "cursor-agent"
    default:
      return provider
  }
}

/**
 * Resume argv per CLI:
 * - codex: `resume <id>`
 * - claude / grok: `--resume <id>`
 * - cursor: `--resume=<id>` (equals form — commander optional `[chatId]` won't eat `--trust`)
 * - opencode: `--session <id>`
 */
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
      return [`--resume=${id}`, ...notifyArgs]
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

  if (provider === "opencode") {
    const ses = chunk.match(OPENCODE_SESSION_RE)?.[1]
    if (ses) return ses
    const uuid = chunk.match(UUID_RE)?.[0]
    if (uuid && /session/i.test(chunk)) return uuid
    return null
  }

  if (provider === "claude") {
    const labeled = chunk.match(CLAUDE_SESSION_RE)?.[1]
    if (labeled) return labeled
    const uuid = chunk.match(UUID_RE)?.[0]
    if (uuid && /session[_ -]?id/i.test(chunk)) return uuid
    return null
  }

  if (provider === "codex") {
    const labeled =
      chunk.match(
        /(?:thread|session)[_ -]?id[=:\s]+([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i,
      )?.[1] ?? null
    if (labeled) return labeled
    const uuid = chunk.match(UUID_RE)?.[0]
    if (uuid && /session|thread/i.test(chunk)) return uuid
    return null
  }

  if (provider === "cursor") {
    // Require labeled session_id — bare UUID fallback steals unrelated ids.
    // create-chat mint uses its own UUID_RE in cursor-cli-session.ts.
    return (
      chunk.match(
        /"session_id"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})"/i,
      )?.[1] ?? null
    )
  }

  if (provider === "grok") {
    const labeled =
      chunk.match(
        /"session_id"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})"/i,
      )?.[1] ?? null
    if (labeled) return labeled
    return chunk.match(UUID_RE)?.[0] ?? null
  }

  return null
}

/**
 * Recover a provider CLI session id from resume argv when the roster column
 * is empty (e.g. persist raced ahead of setAgentCliSessionId).
 */
export function extractAgentCliSessionIdFromLaunchArgs(
  provider: AgentProvider | undefined,
  launchArgs: string[] | undefined,
): string | null {
  if (!provider || !launchArgs?.length) return null
  switch (provider) {
    case "codex":
      if (launchArgs[0] === "resume" && launchArgs[1]?.trim()) {
        return launchArgs[1].trim()
      }
      return null
    case "opencode":
      if (
        (launchArgs[0] === "--session" || launchArgs[0] === "-s") &&
        launchArgs[1]?.trim()
      ) {
        return launchArgs[1].trim()
      }
      return null
    case "cursor": {
      const eq = launchArgs[0]?.match(/^--resume=(.+)$/)
      if (eq?.[1]?.trim()) return eq[1].trim()
      if (launchArgs[0] === "--resume" && launchArgs[1]?.trim()) {
        return launchArgs[1].trim()
      }
      return null
    }
    case "claude":
    case "grok":
      if (launchArgs[0] === "--resume" && launchArgs[1]?.trim()) {
        return launchArgs[1].trim()
      }
      return null
    default:
      return null
  }
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
  /** Resolved id (column or extracted from launchArgs). */
  agentCliSessionId?: string
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
      agentCliSessionId: input.agentCliSessionId?.trim() || undefined,
    }
  }

  const provider =
    (isAgentCliProvider(input.agentId) ? input.agentId : undefined) ??
    detectAgentCliProviderFromCommand(input.launchCommand)

  const cliSessionId =
    input.agentCliSessionId?.trim() ||
    extractAgentCliSessionIdFromLaunchArgs(provider, input.launchArgs) ||
    undefined

  if (!cliSessionId || !provider) {
    return {
      launchCommand: input.launchCommand,
      launchArgs: input.launchArgs,
      ptyId: undefined,
      status:
        input.status === "running" || input.status === "starting"
          ? "starting"
          : input.status,
      agentCliSessionId: cliSessionId,
    }
  }

  return {
    launchCommand: input.launchCommand ?? agentCliCommandForProvider(provider),
    launchArgs: syncAgentCliLaunchArgs(
      input.tabId,
      provider,
      cliSessionId,
      origin,
    ),
    ptyId: undefined,
    status: "starting",
    agentCliSessionId: cliSessionId,
  }
}

export function detectAgentCliProviderFromCommand(
  launchCommand?: string | null,
): AgentProvider | undefined {
  if (!launchCommand) return undefined
  const cmd = launchCommand.trim().split(/\s+/)[0]?.toLowerCase() ?? ""
  if (cmd === "claude" || cmd.endsWith("/claude")) return "claude"
  if (cmd === "codex" || cmd.endsWith("/codex")) return "codex"
  if (cmd === "opencode" || cmd.endsWith("/opencode")) return "opencode"
  if (cmd === "cursor-agent" || cmd.endsWith("/cursor-agent") || cmd === "cursor") {
    return "cursor"
  }
  if (cmd === "grok" || cmd.endsWith("/grok")) return "grok"
  return undefined
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

/**
 * Top-level home sessions are written to the session roster.
 * Child shells (parentSessionTabId) stay in-memory only.
 * Agent stubs without a launch command are incomplete and skipped.
 */
export function isPersistableAgentSession(session: {
  agentId?: string
  launchCommand?: string
  parentSessionTabId?: string
}): boolean {
  if (session.parentSessionTabId) return false
  if (session.agentId && !session.launchCommand?.trim()) return false
  if (session.agentId && !isAgentCliProvider(session.agentId)) return false
  return true
}

/** True when argv already carries this provider's resume flag + id. */
export function launchArgsIncludeResume(
  provider: AgentProvider,
  launchArgs: string[] | undefined,
  cliSessionId: string,
): boolean {
  const id = cliSessionId.trim()
  if (!id || !launchArgs?.length) return false
  switch (provider) {
    case "codex":
      return launchArgs[0] === "resume" && launchArgs[1] === id
    case "opencode":
      return (
        (launchArgs[0] === "--session" || launchArgs[0] === "-s") &&
        launchArgs[1] === id
      )
    case "cursor":
      return (
        launchArgs[0] === `--resume=${id}` ||
        (launchArgs[0] === "--resume" && launchArgs[1] === id)
      )
    case "claude":
    case "grok":
      return launchArgs[0] === "--resume" && launchArgs[1] === id
    default:
      return false
  }
}
