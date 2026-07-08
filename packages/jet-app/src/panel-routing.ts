import type { JetPanelTree } from "@jet/workspace"
import { panelTabIds } from "@jet/workspace"
import type { PanelNode } from "@jet/panels"
import type { Edge, PanelId, PanelView } from "@jet/shared"
export {
  activeTabKind,
  getActiveEditorFileUri,
  getActiveTabId,
} from "./panel-tab-context.js"

export type AuxiliaryPanelOptions = {
  excludePanelIds?: ReadonlySet<number>
  splitEdge?: Edge
}

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
    if (view?.kind === "tabs" || view?.kind === "empty") {
      return focused
    }
  }

  if (editorPanel && panels.some(p => p.id === editorPanel.id)) {
    const view = tree.getView(editorPanel)
    if (view?.kind === "tabs" || view?.kind === "empty") return editorPanel
  }

  const withEditorTabs = panels.find(p => {
    const view = tree.getView(p)
    return view?.kind === "tabs" && view.tabIds.some(id => id.startsWith("file:") || id.startsWith("untitled:"))
  })
  if (withEditorTabs) return withEditorTabs

  const empty = panels.find(p => tree.getView(p)?.kind === "empty")
  if (empty) return empty

  return pickLargestPanel(tree, panels)
}

export function resolveAuxiliaryPanel(
  tree: JetPanelTree,
  focused: PanelId | null,
  opts: AuxiliaryPanelOptions = {},
): PanelId {
  const splitEdge = opts.splitEdge ?? "bottom"

  for (const panel of getAllLeafPanels(tree)) {
    if (opts.excludePanelIds?.has(panel.id)) continue
    const view = tree.getView(panel)
    if (view?.kind === "tabs") return panel
  }

  for (const panel of getAllLeafPanels(tree)) {
    if (opts.excludePanelIds?.has(panel.id)) continue
    if (tree.getView(panel)?.kind === "empty") return panel
  }

  const splitFrom =
    focused && !opts.excludePanelIds?.has(focused.id)
      ? focused
      : resolveEditorPanel(tree, null, focused) ?? getAllLeafPanels(tree)[0]

  if (!splitFrom) return tree.allocPanelId()
  return tree.splitAtEdge(splitFrom, splitEdge)
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

export function getActiveListTabId(tree: JetPanelTree, panel: PanelId | null): string | null {
  if (!panel) return null
  const view = tree.getView(panel)
  if (view?.kind !== "tabs") return null
  const active = view.activeTabId
  if (active.startsWith("jet:") || active.startsWith("list-")) return active
  return null
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
  return getAllLeafPanels(tree).filter(p => {
    const view = tree.getView(p)
    return view?.kind === "tabs"
  })
}

export function closePanelIfEmpty(tree: JetPanelTree, panelId: PanelId): void {
  const view = tree.getView(panelId)
  if (view?.kind !== "empty") return
  if (getAllLeafPanels(tree).length <= 1) return
  tree.closePanel(panelId)
  tree.pruneEmptyLeaves()
}

function panelHasTabs(tree: JetPanelTree, panel: PanelId): boolean {
  const view = tree.getView(panel)
  return view?.kind === "tabs" && panelTabIds(view).length > 0
}

export function reconcileFocusedPanel(
  tree: JetPanelTree,
  focused: PanelId | null,
  editorPanelRef: PanelId | null,
): PanelId | null {
  const leaves = getAllLeafPanels(tree)
  if (leaves.length === 0) return null

  if (focused && leaves.some(l => l.id === focused.id) && panelHasTabs(tree, focused)) {
    return focused
  }

  return (
    resolveEditorPanel(tree, editorPanelRef, focused) ??
    leaves.find(p => panelHasTabs(tree, p)) ??
    leaves[0]!
  )
}
