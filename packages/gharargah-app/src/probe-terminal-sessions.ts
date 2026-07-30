import type { JetElectronTerminal } from "@gharargah/workspace"
import {
  isSessionDone,
  listTerminalSessions,
  markTerminalExited,
  markTerminalUnavailable,
  sessionHasResumableAgentCli,
  type TerminalSessionState,
} from "./tabs/terminal-session.js"

/**
 * After roster hydrate, verify each persisted PTY still exists on the host.
 *
 * Sessions are never dropped on reload. Missing PTYs are marked unavailable
 * (status → starting) so the card stays and TerminalPanel can respawn / resume
 * when the user reopens the session. Done sessions keep their doneAt and only
 * dispose any leftover PTY handle.
 *
 * Returns an empty list for API compatibility with older callers that pruned.
 */
export async function reconcileHydratedTerminalPtys(
  terminalApi: JetElectronTerminal | undefined,
  sessions: TerminalSessionState[] = listTerminalSessions(),
): Promise<string[]> {
  if (!terminalApi?.attach) {
    for (const session of sessions) {
      if (isSessionDone(session.tabId)) continue
      if (sessionHasResumableAgentCli(session.tabId)) {
        markTerminalUnavailable(session.tabId)
        continue
      }
      if (session.ptyId || session.status === "running" || session.status === "failed") {
        markTerminalUnavailable(session.tabId)
      }
    }
    return []
  }

  await Promise.all(
    sessions.map(async session => {
      if (isSessionDone(session.tabId)) {
        if (session.ptyId) {
          try {
            await terminalApi.dispose(session.ptyId)
          } catch {
            /* host may already be gone */
          }
        }
        return
      }

      if (sessionHasResumableAgentCli(session.tabId)) {
        if (session.ptyId) {
          try {
            await terminalApi.dispose(session.ptyId)
          } catch {
            /* host may already be gone */
          }
        }
        markTerminalUnavailable(session.tabId)
        return
      }

      if (!session.ptyId) {
        // Hydrate clears ptyId; keep card as starting so open respawns PTY.
        if (session.status === "running" || session.status === "failed") {
          markTerminalUnavailable(session.tabId)
        }
        return
      }

      try {
        const attached = await terminalApi.attach(session.ptyId)
        if (!attached) {
          try {
            await terminalApi.dispose(session.ptyId)
          } catch {
            /* host may already be gone */
          }
          markTerminalUnavailable(session.tabId)
          return
        }
        if (attached.status === "exited") {
          markTerminalExited(session.ptyId, attached.exitCode ?? 0, attached.signal)
        }
      } catch {
        markTerminalUnavailable(session.tabId)
      }
    }),
  )

  return []
}
