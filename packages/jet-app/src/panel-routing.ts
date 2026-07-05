import type { JetPanelTree } from "@jet/workspace"
import type { PanelNode } from "@jet/panels"
import type { PanelId, PanelView } from "@jet/shared"

export function resolveTargetPanel(
  tree: JetPanelTree,
  focused: PanelId | null,
): PanelId | null {
  if (focused) return focused
  return getAllLeafPanels(tree)[0] ?? null
}

export function resolveEditorPanel(
  tree: JetPanelTree,
  editorPanel: PanelId | null,
  focused: PanelId | null,
): PanelId | null {
  const panels = getAllLeafPanels(tree)
  if (panels.length === 0) return null

  if (focused) {
    const view = tree.getView(focused)
    if (view?.kind === "editor" || view?.kind === "empty") return focused
  }

  if (editorPanel && panels.some(p => p.id === editorPanel.id)) {
    const view = tree.getView(editorPanel)
    if (view?.kind === "editor" || view?.kind === "empty") return editorPanel
  }

  const withEditor = panels.find(p => tree.getView(p)?.kind === "editor")
  if (withEditor) return withEditor

  const empty = panels.find(p => tree.getView(p)?.kind === "empty")
  if (empty) return empty

  const nonSidebar = panels.filter(p => !isSidebarPanel(tree, p))
  return pickLargestPanel(tree, nonSidebar.length > 0 ? nonSidebar : panels)
}

function isSidebarPanel(tree: JetPanelTree, panel: PanelId): boolean {
  const view = tree.getView(panel)
  return view?.kind === "explorer" || view?.kind === "locationlist"
}

const EDITOR_LAYOUT_VIEWPORT = { x: 0, y: 0, width: 1280, height: 800 }

function panelArea(tree: JetPanelTree, panel: PanelId): number {
  const rect = tree.computeRects(EDITOR_LAYOUT_VIEWPORT).get(panel.id)
  return rect ? rect.width * rect.height : 0
}

function pickLargestPanel(tree: JetPanelTree, panels: PanelId[]): PanelId | null {
  if (panels.length === 0) return null
  return panels.reduce((best, p) => (panelArea(tree, p) > panelArea(tree, best) ? p : best))
}

export function panelViewKind(
  tree: JetPanelTree,
  panel: PanelId,
): PanelView["kind"] | undefined {
  return tree.getView(panel)?.kind
}

export function getAllLeafPanels(tree: JetPanelTree): PanelId[] {
  const result: PanelId[] = []
  walk(tree.root, node => {
    if (node.kind === "leaf") result.push(node.panelId)
  })
  return result
}

function walk(node: PanelNode<PanelView>, fn: (n: PanelNode<PanelView>) => void) {
  fn(node)
  if (node.kind !== "leaf") node.split.children.forEach((c: PanelNode<PanelView>) => walk(c, fn))
}

export function getEditorPanels(tree: JetPanelTree): PanelId[] {
  return getAllLeafPanels(tree).filter(p => tree.getView(p)?.kind === "editor")
}

export function getActiveEditorFileUri(tree: JetPanelTree, panel: PanelId | null): string | null {
  if (!panel) return null
  const view = tree.getView(panel)
  if (view?.kind !== "editor") return null
  return view.fileUri
}
