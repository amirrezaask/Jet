import { PanelTree } from "@jet/panels"
import type { PanelId, PanelNode } from "@jet/shared"
import type { TabKind, TabRegistry } from "@jet/workspace"

export function resolveTargetPanel(
  tree: PanelTree,
  focused: PanelId | null,
  registry: TabRegistry,
): PanelId | null {
  if (focused) return focused
  return getAllLeafPanels(tree)[0] ?? null
}

export function moveEditorTabsToMain(
  tree: PanelTree,
  registry: TabRegistry,
  sidebarPanel: PanelId,
  editorPanel: PanelId,
): void {
  const sidebarLeaf = tree.getLeaf(sidebarPanel)
  if (!sidebarLeaf) return
  for (const tab of [...sidebarLeaf.group.tabs]) {
    if (registry.get(tab)?.kind !== "editor") continue
    tree.removeTab(tab)
    tree.insertTab(editorPanel, tab)
    registry.setPanel(tab, editorPanel)
  }
}

export function resolveEditorPanel(
  tree: PanelTree,
  registry: TabRegistry,
  editorPanel: PanelId | null,
  focused: PanelId | null,
): PanelId | null {
  const panels = getAllLeafPanels(tree)
  if (panels.length === 0) return null

  if (focused && panelHasEditor(tree, focused, registry)) return focused

  if (editorPanel && panels.some(p => p.id === editorPanel.id)) return editorPanel

  const withEditor = panels.find(p => panelHasEditor(tree, p, registry))
  if (withEditor) return withEditor

  const nonSidebar = panels.filter(p => !isSidebarOnlyPanel(tree, p, registry))
  return pickLargestPanel(tree, nonSidebar.length > 0 ? nonSidebar : panels)
}

function panelHasEditor(tree: PanelTree, panel: PanelId, registry: TabRegistry): boolean {
  const leaf = tree.getLeaf(panel)
  if (!leaf) return false
  return leaf.group.tabs.some(t => registry.get(t)?.kind === "editor")
}

function isSidebarOnlyPanel(tree: PanelTree, panel: PanelId, registry: TabRegistry): boolean {
  const leaf = tree.getLeaf(panel)
  if (!leaf || leaf.group.tabs.length === 0) return false
  return leaf.group.tabs.every(t => {
    const kind = registry.get(t)?.kind
    return kind === "explorer" || kind === "git" || kind === "search" || kind === "problems"
  })
}

const EDITOR_LAYOUT_VIEWPORT = { x: 0, y: 0, width: 1280, height: 800 }

function panelArea(tree: PanelTree, panel: PanelId): number {
  const rect = tree.computeRects(EDITOR_LAYOUT_VIEWPORT).get(panel.id)
  return rect ? rect.width * rect.height : 0
}

function pickLargestPanel(tree: PanelTree, panels: PanelId[]): PanelId | null {
  if (panels.length === 0) return null
  return panels.reduce((best, p) => (panelArea(tree, p) > panelArea(tree, best) ? p : best))
}

export function activeTabKind(
  tree: PanelTree,
  panel: PanelId,
  registry: TabRegistry,
): TabKind["kind"] | undefined {
  const leaf = tree.getLeaf(panel)
  const tab = leaf?.group.tabs[leaf.group.active]
  return tab ? registry.get(tab)?.kind : undefined
}

export function getAllLeafPanels(tree: PanelTree): PanelId[] {
  const result: PanelId[] = []
  walk(tree.root, node => {
    if (node.kind === "leaf") result.push(node.panelId)
  })
  return result
}

function walk(node: PanelNode, fn: (n: PanelNode) => void) {
  fn(node)
  if (node.kind !== "leaf") node.split.children.forEach((c: PanelNode) => walk(c, fn))
}
