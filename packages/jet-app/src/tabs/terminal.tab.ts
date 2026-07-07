import { createElement } from "react"
import type { TabType } from "@jet/ui"
import { TerminalPanel } from "@jet/ui"
import type { TabContributorDeps } from "./deps.js"
import {
  clearTerminalSession,
  registerTerminalSession,
  terminalCwdForTab,
  terminalPtyIdForTab,
  trackTerminalPtyId,
} from "./terminal-session.js"

export const TERMINAL_TAB_TYPE_ID = "terminal"
export { registerTerminalSession, terminalCwdForTab }

export type TerminalTabState = { label: string; cwdRootUri: string }

export function createTerminalTabType(deps: TabContributorDeps): TabType<TerminalTabState> {
  return {
    id: TERMINAL_TAB_TYPE_ID,
    keepMounted: true,
    title: state => state.label,
    dispose: instance => {
      const ptyId = terminalPtyIdForTab(instance.id)
      if (ptyId) void window.jet?.terminal?.dispose(ptyId)
      clearTerminalSession(instance.id)
    },
    render: (instance, ctx) =>
      createElement(TerminalPanel, {
        cwdRootUri: instance.state.cwdRootUri,
        theme: deps.getTheme(),
        tabId: instance.id,
        focused: ctx.focused && ctx.isActive,
        isActive: ctx.isActive,
        onPtyId: trackTerminalPtyId,
        onTitleChange: deps.onTerminalTitleChange,
      }),
  }
}
