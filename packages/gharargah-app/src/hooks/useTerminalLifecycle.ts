import { useEffect } from "react"
import { markTerminalExited } from "../tabs/terminal-session.js"

export function useTerminalLifecycle(): void {
  useEffect(() => {
    if (!window.gharargah?.terminal?.onExit) return
    return window.gharargah.terminal.onExit((ptyId, exitCode, signal) => {
      markTerminalExited(ptyId, exitCode, signal)
    })
  }, [])
}
