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
 * Returns tab ids that cannot be loaded (missing/failed attach) so the app can
 * drop those home cards. Agent CLI sessions with a stored provider session id
 * are kept and will spawn a resume launch instead of reattaching a dead PTY.
 */
export async function reconcileHydratedTerminalPtys(
  terminalApi: JetElectronTerminal | undefined,
  sessions: TerminalSessionState[] = listTerminalSessions(),
): Promise<string[]> {
  const deadTabIds: string[] = []

  if (!terminalApi?.attach) {
    for (const session of sessions) {
      if (isSessionDone(session.tabId)) continue
      if (sessionHasResumableAgentCli(session.tabId)) continue
      if (session.ptyId || session.status === "running" || session.status === "failed") {
        deadTabIds.push(session.tabId)
      }
    }
    return deadTabIds
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
          markTerminalUnavailable(session.tabId)
        }
        return
      }

      if (!session.ptyId) {
        deadTabIds.push(session.tabId)
        return
      }
      try {
        const attached = await terminalApi.attach(session.ptyId)
        if (!attached) {
          deadTabIds.push(session.tabId)
          return
        }
        if (attached.status === "exited") {
          markTerminalExited(session.ptyId, attached.exitCode ?? 0, attached.signal)
        }
      } catch {
        deadTabIds.push(session.tabId)
      }
    }),
  )

  return deadTabIds
}
