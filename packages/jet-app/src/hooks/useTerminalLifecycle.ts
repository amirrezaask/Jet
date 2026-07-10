import { useEffect } from "react"
import { markTerminalExited } from "../tabs/terminal-session.js"

export function useTerminalLifecycle(): void {
  useEffect(() => {
    if (!window.jet?.terminal?.onExit) return
    return window.jet.terminal.onExit((ptyId, exitCode, signal) => {
      markTerminalExited(ptyId, exitCode, signal)
    })
  }, [])
}
