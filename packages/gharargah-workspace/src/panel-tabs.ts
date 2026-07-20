import type { PanelId, PanelView } from "@gharargah/shared"
import { fileUriToPath } from "@gharargah/shared"
import type { GharargahPanelTree } from "./panel-tree.js"

export type TabsPanelView = Extract<PanelView, { kind: "tabs" }>

export function panelTabIds(view: PanelView | null): string[] {
  if (!view || view.kind !== "tabs") return []
  return view.tabIds.length ? view.tabIds : [view.activeTabId]
}

export function buildTabsView(activeTabId: string, tabIds: string[]): TabsPanelView {
  const ordered = tabIds.filter((id, i, arr) => arr.indexOf(id) === i)
  if (!ordered.includes(activeTabId)) ordered.push(activeTabId)
  return { kind: "tabs", activeTabId, tabIds: ordered }
}

export function panelHasTab(view: PanelView | null, tabId: string): boolean {
  if (!view || view.kind !== "tabs") return false
  return panelTabIds(view).includes(tabId)
}

export function sameFileTab(a: string, b: string): boolean {
  return fileUriToPath(a) === fileUriToPath(b)
}

export function findTabIdForFile(view: PanelView | null, fileUri: string): string | null {
  if (!view || view.kind !== "tabs") return null
  const path = fileUriToPath(fileUri)
  return panelTabIds(view).find(id => fileUriToPath(id) === path) ?? null
}

export function panelHasTabForFile(view: PanelView | null, fileUri: string): boolean {
  return findTabIdForFile(view, fileUri) != null
}

export function pushPanelTab(
  current: PanelView | null,
  tabId: string,
  replaceTabId?: string,
): TabsPanelView {
  if (current?.kind === "tabs") {
    let existing = panelTabIds(current)
    if (replaceTabId) existing = existing.map(id => (id === replaceTabId ? tabId : id))
    const pathMatch = existing.find(id => sameFileTab(id, tabId))
    if (pathMatch) {
      return { kind: "tabs", activeTabId: pathMatch, tabIds: existing }
    }
    if (!existing.includes(tabId)) existing = [...existing, tabId]
    return { kind: "tabs", activeTabId: tabId, tabIds: existing }
  }
  return { kind: "tabs", activeTabId: tabId, tabIds: [tabId] }
}

export function popPanelTab(current: TabsPanelView, tabId: string): PanelView {
  const tabIds = panelTabIds(current).filter(id => id !== tabId)
  if (tabIds.length === 0) return { kind: "empty" }
  const active = current.activeTabId === tabId ? tabIds[0]! : current.activeTabId
  return { kind: "tabs", activeTabId: active, tabIds }
}

export function activatePanelTab(current: TabsPanelView, tabId: string): TabsPanelView {
  const tabIds = panelTabIds(current)
  if (!tabIds.includes(tabId)) return current
  return { kind: "tabs", activeTabId: tabId, tabIds }
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

export function findPanelWithTab(tree: GharargahPanelTree, tabId: string): PanelId | null {
  return tree.findPanelWithView(v => panelHasTab(v, tabId))
}
