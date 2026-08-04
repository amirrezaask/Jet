import type { DropAction, Edge, PanelId, PanelView } from "@yaade/shared"
import {
  YaadePanelTree,
  buildTabsView,
  findPanelWithTab,
  isTerminalTabId,
  panelTabIds,
  popPanelTab,
} from "@yaade/workspace"
import { closePanelIfEmpty, getAllLeafPanels } from "../panel-routing.js"

/** One terminal tab per leaf panel. */
export function paneView(ptyTabId: string): PanelView {
  return buildTabsView(ptyTabId, [ptyTabId])
}

export function activePtyInPanel(
  tree: YaadePanelTree,
  panelId: PanelId | null,
): string | null {
  if (!panelId) return null
  const view = tree.getView(panelId)
  if (!view || view.kind !== "tabs") return null
  const id = view.activeTabId
  return isTerminalTabId(id) ? id : null
}

export function listPaneLeaves(
  tree: YaadePanelTree,
): { panelId: PanelId; ptyTabId: string }[] {
  const out: { panelId: PanelId; ptyTabId: string }[] = []
  for (const panelId of getAllLeafPanels(tree)) {
    const ptyTabId = activePtyInPanel(tree, panelId)
    if (ptyTabId) out.push({ panelId, ptyTabId })
  }
  return out
}

export function placePtyInTree(
  tree: YaadePanelTree,
  ptyTabId: string,
  focused: PanelId | null,
  splitEdge: Edge = "right",
): PanelId {
  const existing = findPanelWithTab(tree, ptyTabId)
  if (existing) {
    tree.setView(existing, paneView(ptyTabId))
    return existing
  }

  const leaves = getAllLeafPanels(tree)
  const anchor =
    (focused && leaves.some(p => p.id === focused.id) ? focused : null) ??
    leaves[0] ??
    (tree.root.kind === "leaf" ? tree.root.panelId : tree.allocPanelId())

  const occupied = activePtyInPanel(tree, anchor) != null
  const target = occupied ? tree.splitAtEdge(anchor, splitEdge) : anchor
  tree.setView(target, paneView(ptyTabId))
  return target
}

export function removePtyFromTree(
  tree: YaadePanelTree,
  panelId: PanelId,
  ptyTabId: string,
): void {
  const view = tree.getView(panelId)
  if (!view || view.kind !== "tabs") return
  if (!panelTabIds(view).includes(ptyTabId)) return
  tree.setView(panelId, popPanelTab(view, ptyTabId))
  closePanelIfEmpty(tree, panelId)
}

export function emptyMuxTree(): YaadePanelTree {
  const { tree } = YaadePanelTree.editorOnlyLayout()
  return tree
}

/**
 * Place a PTY that is not in this window's tree (e.g. docking another window).
 * Edge → split; center → swap with target (displaced pane stays as a sibling split).
 */
export function placePtyFromOutside(
  tree: YaadePanelTree,
  ptyTabId: string,
  target: PanelId,
  action: DropAction,
): PanelId {
  const existing = findPanelWithTab(tree, ptyTabId)
  if (existing) {
    tree.setView(existing, paneView(ptyTabId))
    return existing
  }

  if (action.kind === "split") {
    const created = tree.splitAtEdge(target, action.edge)
    tree.setView(created, paneView(ptyTabId))
    return created
  }

  const targetPty = activePtyInPanel(tree, target)
  tree.setView(target, paneView(ptyTabId))
  if (targetPty && targetPty !== ptyTabId) {
    const created = tree.splitAtEdge(target, "right")
    tree.setView(created, paneView(targetPty))
  }
  return target
}

/** Merge every leaf from a source window into `tree` at `target` / `action`. */
export function dockSourceLeavesIntoTree(
  tree: YaadePanelTree,
  leaves: { ptyTabId: string }[],
  target: PanelId,
  action: DropAction,
): PanelId {
  let focus = target
  for (let i = 0; i < leaves.length; i++) {
    const ptyTabId = leaves[i]!.ptyTabId
    if (i === 0) {
      focus = placePtyFromOutside(tree, ptyTabId, target, action)
    } else {
      focus = placePtyFromOutside(tree, ptyTabId, focus, {
        kind: "split",
        edge: "right",
      })
    }
  }
  return focus
}
