import type { JetElectronTerminal } from "@gharargah/workspace"
import {
  listTerminalSessions,
  markTerminalExited,
  markTerminalUnavailable,
  type TerminalSessionState,
} from "./tabs/terminal-session.js"

/**
 * After roster hydrate, verify each persisted PTY still exists on the host.
 * Missing / unloadable processes stay as home cards with failed/exited status.
 */
export async function reconcileHydratedTerminalPtys(
  terminalApi: JetElectronTerminal | undefined,
  sessions: TerminalSessionState[] = listTerminalSessions(),
): Promise<void> {
  if (!terminalApi?.attach) {
    for (const session of sessions) {
      if (session.ptyId || session.status === "running") {
        markTerminalUnavailable(session.tabId)
      }
    }
    return
  }

  await Promise.all(
    sessions.map(async session => {
      if (!session.ptyId) {
        if (session.status === "running") markTerminalUnavailable(session.tabId)
        return
      }
      try {
        const attached = await terminalApi.attach(session.ptyId)
        if (!attached) {
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
}
