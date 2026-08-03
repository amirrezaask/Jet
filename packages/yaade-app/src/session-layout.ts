import type { PanelId, PanelView } from "@yaade/shared"
import {
  YaadePanelTree,
  findPanelWithTab,
  isTerminalTabId,
  panelTabIds,
  popPanelTab,
  type WorkspaceService,
} from "@yaade/workspace"
import { TERMINAL_TAB_TYPE_ID } from "./tabs/terminal.tab.js"
import { resolveTargetPanel, closePanelIfEmpty, getAllLeafPanels } from "./panel-routing.js"
import { terminalSessionForTab } from "./tabs/terminal-session.js"

/** Panel view filtered to terminal session tabs only (for session window chrome). */
export function terminalOnlyView(view: PanelView | null): PanelView {
  if (!view || view.kind !== "tabs") return { kind: "empty" }
  const tabIds = panelTabIds(view).filter(isTerminalTabId)
  if (tabIds.length === 0) return { kind: "empty" }
  const activeTabId = tabIds.includes(view.activeTabId)
    ? view.activeTabId
    : tabIds[0]!
  return { kind: "tabs", activeTabId, tabIds }
}

export function activeTerminalTabInPanel(
  tree: YaadePanelTree,
  panelId: PanelId | null,
): string | null {
  if (!panelId) return null
  const view = terminalOnlyView(tree.getView(panelId))
  if (view.kind !== "tabs") return null
  return view.activeTabId
}

/**
 * 1A: if session already open in any pane → focus it; else open as a tab in the
 * focused pane (or first leaf).
 */
export function openSessionInLayout(
  workspace: WorkspaceService,
  tree: YaadePanelTree,
  tabId: string,
  focused: PanelId | null,
): { panelId: PanelId; tabId: string; created: boolean } {
  const existing = findPanelWithTab(tree, tabId)
  if (existing) {
    workspace.focusTabInPanel(tree, existing, tabId)
    return { panelId: existing, tabId, created: false }
  }

  const session = terminalSessionForTab(tabId)
  const label =
    session?.customLabel ??
    session?.agentTitle ??
    workspace.tabRegistry.get(tabId)?.label ??
    "Terminal"

  const target =
    resolveTargetPanel(tree, focused) ??
    getAllLeafPanels(tree)[0] ??
    (tree.root.kind === "leaf" ? tree.root.panelId : tree.allocPanelId())

  const opened = workspace.openOrFocusTab(tree, target, {
    id: tabId,
    kind: TERMINAL_TAB_TYPE_ID,
    label,
  })
  return { panelId: opened.panelId, tabId: opened.tabId, created: true }
}

/**
 * 2A: remove session tab from the tiled layout without disposing the session.
 */
export function hideSessionFromLayout(
  tree: YaadePanelTree,
  panelId: PanelId,
  tabId: string,
): void {
  const view = tree.getView(panelId)
  if (view?.kind !== "tabs") return
  if (!panelTabIds(view).includes(tabId)) return
  tree.setView(panelId, popPanelTab(view, tabId))
  closePanelIfEmpty(tree, panelId)
}
