import { createElement } from "react"
import type { TabType } from "@jet/ui"
import { TerminalExplorerTab } from "@jet/ui"
import type { TabContributorDeps } from "./deps.js"

import type { KnownTabKind } from "@jet/workspace"

export const TERMINAL_EXPLORER_TAB_TYPE_ID: KnownTabKind = "terminal-explorer"
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
        activeProjectRootUri: deps.workspace.root?.uri ?? null,
        activeTerminalTabId: deps.getActiveTerminalTabId(),
        onActivateProject: rootUri => {
          const folder = deps.workspace.folders.find(candidate => candidate.root.uri === rootUri)
          if (folder) deps.workspace.setActiveFolder(folder.id)
        },
        onFocusTerminal: (panelId, tabId) => deps.focusTerminalTab(panelId, tabId),
        onNewTerminal: rootUri => void deps.newTerminalInWorkspace(rootUri),
        onLaunchAgentTerminal: (rootUri, shortcut) =>
          deps.launchAgentTerminal(rootUri, shortcut),
        onCloseTerminal: (panelId, tabId) => deps.closeTerminalTab(panelId, tabId),
        onRenameTerminal: (tabId, label) => deps.onTerminalTitleChange(tabId, label),
        onDuplicateTerminal: () => {},
        onRestartTerminal: () => {},
        onRemoveProject: () => {},
      }),
    keepMounted: true,
  }
}
