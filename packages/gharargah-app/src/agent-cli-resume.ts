/**
 * Ensure an agent CLI session has a live process. When the PTY is missing,
 * exited, or failed — and we have a stored provider session id — sync each
 * CLI's resume argv and bump generation so TerminalPanel respawns.
 */
import {
  detectAgentCliProviderFromCommand,
  isAgentCliProvider,
  launchArgsIncludeResume,
  syncAgentCliLaunchArgs,
} from "./agent-cli-launch.js"
import {
  isSessionDone,
  restartTerminalSession,
  terminalSessionForTab,
  updateTerminalLaunchArgs,
  type TerminalSessionState,
} from "./tabs/terminal-session.js"

export function resolveAgentCliProvider(
  session: TerminalSessionState,
): import("@gharargah/shared").AgentProvider | undefined {
  if (isAgentCliProvider(session.agentId)) return session.agentId
  return detectAgentCliProviderFromCommand(session.launchCommand)
}

/** Sync resume launch args onto the session when a provider session id is known. */
export function applyAgentCliResumeLaunchArgs(tabId: string): boolean {
  const session = terminalSessionForTab(tabId)
  if (!session?.agentCliSessionId) return false
  const provider = resolveAgentCliProvider(session)
  if (!provider) return false
  const next = syncAgentCliLaunchArgs(tabId, provider, session.agentCliSessionId)
  if (launchArgsIncludeResume(provider, session.launchArgs, session.agentCliSessionId)) {
    // Still refresh notify/trust args in case origin/hooks changed.
    const same =
      session.launchArgs?.length === next.length &&
      session.launchArgs.every((arg, i) => arg === next[i])
    if (same) return true
  }
  updateTerminalLaunchArgs(tabId, next)
  return true
}

function agentCliProcessNeedsRespawn(session: TerminalSessionState): boolean {
  if (!session.launchCommand?.trim()) return false
  if (session.status === "exited" || session.status === "failed") return true
  // Inconsistent: claimed running but no PTY handle.
  if (session.status === "running" && !session.ptyId) return true
  // `starting` without pty is the normal first-spawn / post-hydrate path —
  // TerminalPanel creates the process; do not bump generation here.
  return false
}

/**
 * If this ADE agent session's CLI process is not usable, prepare resume argv
 * (when a provider session id is stored) and restart so TerminalPanel spawns
 * a fresh process. No-op for done sessions / blank shells without launch cmd.
 *
 * @returns true when a respawn was requested
 */
export function ensureAgentCliProcess(tabId: string): boolean {
  if (isSessionDone(tabId)) return false
  const session = terminalSessionForTab(tabId)
  if (!session) return false
  if (!resolveAgentCliProvider(session) && !session.launchCommand?.trim()) {
    return false
  }
  if (!agentCliProcessNeedsRespawn(session)) return false

  applyAgentCliResumeLaunchArgs(tabId)

  const ptyId = session.ptyId
  if (ptyId) void window.gharargah?.terminal?.dispose(ptyId)
  restartTerminalSession(tabId)
  return true
}
