import { createElement } from "react"
import type { TabType } from "@jet/ui"
import { TerminalExplorerTab } from "@jet/ui"
import type { TabContributorDeps } from "./deps.js"

export const TERMINAL_EXPLORER_TAB_TYPE_ID = "terminal-explorer"
export const TERMINAL_EXPLORER_TAB_ID = "jet:terminal-explorer"

export type TerminalExplorerTabState = Record<string, never>

export function createTerminalExplorerTabType(
  deps: TabContributorDeps,
): TabType<TerminalExplorerTabState> {
  return {
    id: TERMINAL_EXPLORER_TAB_TYPE_ID,
    title: () => "Terminals",
    render: () =>
      createElement(TerminalExplorerTab, {
        groups: deps.getTerminalExplorerGroups(),
        activeTerminalTabId: deps.getActiveTerminalTabId(),
        onFocusTerminal: (panelId, tabId) => deps.focusTerminalTab(panelId, tabId),
        onNewTerminal: rootUri => void deps.newTerminalInWorkspace(rootUri),
        onLaunchAgentTerminal: (rootUri, shortcut) =>
          deps.launchAgentTerminal(rootUri, shortcut),
        onCloseTerminal: (panelId, tabId) => deps.closeTerminalTab(panelId, tabId),
      }),
    keepMounted: true,
  }
}
