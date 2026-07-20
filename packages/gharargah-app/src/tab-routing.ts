import type { GharargahPanelTree, WorkspaceService } from "@gharargah/workspace"
import { normalizeAbsPath } from "@gharargah/workspace"
import { fileUriToPath } from "@gharargah/shared"
import {
  findPanelWithTab,
  isTerminalTabId,
  panelTabIds,
  terminalTabId,
} from "@gharargah/workspace"
import type { PanelId } from "@gharargah/shared"
import { resolveAuxiliaryPanel, getAllLeafPanels } from "./panel-routing.js"
import { TERMINAL_TAB_TYPE_ID, registerTerminalSession } from "./tabs/terminal.tab.js"
import { terminalCwdForTab } from "./tabs/terminal-session.js"

export type OpenTerminalTabOpts = {
  sessionKey?: string
  label?: string
  cwdRootUri?: string
  launchCommand?: string
}

export function listTerminalTabs(
  tree: GharargahPanelTree,
): { panelId: PanelId; tabId: string }[] {
  const result: { panelId: PanelId; tabId: string }[] = []
  for (const panel of getAllLeafPanels(tree)) {
    const view = tree.getView(panel)
    if (view?.kind !== "tabs") continue
    for (const tabId of panelTabIds(view)) {
      if (isTerminalTabId(tabId)) result.push({ panelId: panel, tabId })
    }
  }
  return result
}

function rootUriKey(uri: string): string {
  if (!uri) return ""
  try {
    return normalizeAbsPath(fileUriToPath(uri))
  } catch {
    return uri
  }
}

export function listTerminalTabsForRoot(
  tree: GharargahPanelTree,
  rootUri: string,
): { panelId: PanelId; tabId: string }[] {
  const key = rootUriKey(rootUri)
  return listTerminalTabs(tree).filter(
    ({ tabId }) => rootUriKey(terminalCwdForTab(tabId)) === key,
  )
}

export function isActiveTerminalTab(tree: GharargahPanelTree, focused: PanelId | null): boolean {
  if (!focused) return false
  const view = tree.getView(focused)
  if (view?.kind !== "tabs") return false
  return isTerminalTabId(view.activeTabId)
}

export function openTerminalTab(
  workspace: WorkspaceService,
  tree: GharargahPanelTree,
  focused: PanelId | null,
  opts: OpenTerminalTabOpts = {},
): { panelId: PanelId; tabId: string } {
  const sessionKey = opts.sessionKey ?? `session-${Date.now()}`
  const tabId = terminalTabId(sessionKey)
  const label = opts.label ?? "Terminal"
  const cwdRootUri = opts.cwdRootUri ?? workspace.root?.uri ?? ""
  const panel = resolveAuxiliaryPanel(tree, focused, { splitEdge: "bottom" })
  registerTerminalSession(tabId, cwdRootUri, opts.launchCommand)
  return workspace.openOrFocusTab(tree, panel, {
    id: tabId,
    kind: TERMINAL_TAB_TYPE_ID,
    label,
  })
}
