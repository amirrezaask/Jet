import type { PanelId, PanelView } from "@jet/shared"
import type { JetPanelTree } from "./panel-tree.js"

export type TabsPanelView = Extract<PanelView, { kind: "tabs" }>

export function panelTabIds(view: PanelView | null): string[] {
  if (!view || view.kind !== "tabs") return []
  return view.tabIds.length ? view.tabIds : [view.activeTabId]
}

export function buildTabsView(activeTabId: string, tabIds: string[]): TabsPanelView {
  const unique = [activeTabId, ...tabIds.filter(id => id !== activeTabId)]
  return { kind: "tabs", activeTabId, tabIds: unique }
}

export function panelHasTab(view: PanelView | null, tabId: string): boolean {
  if (!view || view.kind !== "tabs") return false
  return panelTabIds(view).includes(tabId)
}

export function pushPanelTab(
  current: PanelView | null,
  tabId: string,
  replaceTabId?: string,
): TabsPanelView {
  if (current?.kind === "tabs") {
    let existing = panelTabIds(current)
    if (replaceTabId) existing = existing.map(id => (id === replaceTabId ? tabId : id))
    if (!existing.includes(tabId)) existing = [...existing, tabId]
    return buildTabsView(tabId, existing)
  }
  return { kind: "tabs", activeTabId: tabId, tabIds: [tabId] }
}

export function popPanelTab(current: TabsPanelView, tabId: string): PanelView {
  const tabIds = panelTabIds(current).filter(id => id !== tabId)
  if (tabIds.length === 0) return { kind: "empty" }
  const active = current.activeTabId === tabId ? tabIds[0]! : current.activeTabId
  return buildTabsView(active, tabIds)
}

export function activatePanelTab(current: TabsPanelView, tabId: string): TabsPanelView {
  if (!panelTabIds(current).includes(tabId)) return current
  return buildTabsView(tabId, panelTabIds(current))
}

export function reorderPanelTab(current: TabsPanelView, tabId: string, toIndex: number): TabsPanelView {
  const tabIds = panelTabIds(current).slice()
  const from = tabIds.indexOf(tabId)
  if (from < 0) return current
  tabIds.splice(from, 1)
  const to = Math.max(0, Math.min(tabIds.length, toIndex > from ? toIndex - 1 : toIndex))
  tabIds.splice(to, 0, tabId)
  return { kind: "tabs", activeTabId: current.activeTabId, tabIds }
}

export function findPanelWithTab(tree: JetPanelTree, tabId: string): PanelId | null {
  return tree.findPanelWithView(v => panelHasTab(v, tabId))
}
