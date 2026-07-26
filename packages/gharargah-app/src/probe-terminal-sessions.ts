import type { JetElectronTerminal } from "@gharargah/workspace"
import {
  listTerminalSessions,
  markTerminalExited,
  type TerminalSessionState,
} from "./tabs/terminal-session.js"

/**
 * After roster hydrate, verify each persisted PTY still exists on the host.
 * Returns tab ids that cannot be loaded (missing/failed attach) so the app can
 * drop those home cards. Attachable exited sessions stay (buffer + restart).
 */
export async function reconcileHydratedTerminalPtys(
  terminalApi: JetElectronTerminal | undefined,
  sessions: TerminalSessionState[] = listTerminalSessions(),
): Promise<string[]> {
  const deadTabIds: string[] = []

  if (!terminalApi?.attach) {
    for (const session of sessions) {
      if (session.ptyId || session.status === "running" || session.status === "failed") {
        deadTabIds.push(session.tabId)
      }
    }
    return deadTabIds
  }

  await Promise.all(
    sessions.map(async session => {
      if (!session.ptyId) {
        // No host process to attach — cannot restore this card.
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
