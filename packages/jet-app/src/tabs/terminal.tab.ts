import { createElement } from "react"
import type { TabType } from "@jet/ui"
import { TerminalPanel } from "@jet/ui"
import type { TabContributorDeps } from "./deps.js"

export const TERMINAL_TAB_TYPE_ID = "terminal"

export type TerminalTabState = { label: string }

const ptyByTabId = new Map<string, string>()

function trackPtyId(tabId: string, ptyId: string | null): void {
  if (ptyId) ptyByTabId.set(tabId, ptyId)
  else ptyByTabId.delete(tabId)
}

export function createTerminalTabType(deps: TabContributorDeps): TabType<TerminalTabState> {
  return {
    id: TERMINAL_TAB_TYPE_ID,
    keepMounted: true,
    title: state => state.label,
    dispose: instance => {
      const ptyId = ptyByTabId.get(instance.id)
      if (ptyId) void window.jet?.terminal?.dispose(ptyId)
      ptyByTabId.delete(instance.id)
    },
    render: (instance, ctx) =>
      createElement(TerminalPanel, {
        workspace: deps.workspace,
        theme: deps.getTheme(),
        tabId: instance.id,
        focused: ctx.focused && ctx.isActive,
        isActive: ctx.isActive,
        onPtyId: trackPtyId,
      }),
  }
}
