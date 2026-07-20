import type { GharargahPanelTree } from "@gharargah/workspace"
import { EXPLORER_TAB_ID, panelTabIds, popPanelTab } from "@gharargah/workspace"
import { TERMINAL_EXPLORER_TAB_ID } from "./tabs/terminal-explorer.tab.js"
import { closePanelIfEmpty, getAllLeafPanels } from "./panel-routing.js"

const SIDEBAR_TAB_IDS = new Set([EXPLORER_TAB_ID, TERMINAL_EXPLORER_TAB_ID])

/** Remove legacy file/terminal explorer tabs from the panel tree (now fixed sidebar). */
export function stripSidebarTabsFromTree(tree: GharargahPanelTree): boolean {
  let changed = false
  for (const panel of getAllLeafPanels(tree)) {
    const view = tree.getView(panel)
    if (view?.kind !== "tabs") continue
    let next = view
    let panelChanged = false
    for (const tabId of panelTabIds(view)) {
      if (!SIDEBAR_TAB_IDS.has(tabId)) continue
      next = popPanelTab(next, tabId) as typeof view
      panelChanged = true
    }
    if (panelChanged) {
      tree.setView(panel, next)
      closePanelIfEmpty(tree, panel)
      changed = true
    }
  }
  if (changed) tree.pruneEmptyLeaves()
  return changed
}
