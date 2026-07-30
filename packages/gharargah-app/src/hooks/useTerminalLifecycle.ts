import { useEffect } from "react"
import { applyAgentCliResumeLaunchArgs } from "../agent-cli-resume.js"
import {
  markTerminalExited,
  terminalTabIdForPty,
} from "../tabs/terminal-session.js"

export function useTerminalLifecycle(): void {
  useEffect(() => {
    if (!window.gharargah?.terminal?.onExit) return
    return window.gharargah.terminal.onExit((ptyId, exitCode, signal) => {
      const tabId = terminalTabIdForPty(ptyId)
      markTerminalExited(ptyId, exitCode, signal)
      // Keep resume argv ready for the next spawn (reload / reopen / Restart).
      if (tabId) applyAgentCliResumeLaunchArgs(tabId)
    })
  }, [])
}
