import type { DropAction, Edge, PanelId, PanelView } from "@yaade/shared"
import {
  YaadePanelTree,
  buildTabsView,
  findPanelWithTab,
  isEditorTabId,
  isGitTabId,
  isTerminalTabId,
  panelTabIds,
  popPanelTab,
} from "@yaade/workspace"
import { closePanelIfEmpty, getAllLeafPanels } from "../panel-routing.js"

export type MuxLeafKind = "terminal" | "git" | "editor"

export type MuxLeaf = {
  panelId: PanelId
  /** Terminal, git, or editor tab id (legacy field name kept for call-site churn). */
  ptyTabId: string
  kind: MuxLeafKind
}

/** One content tab per leaf panel. */
export function paneView(tabId: string): PanelView {
  return buildTabsView(tabId, [tabId])
}

export function muxLeafKind(tabId: string): MuxLeafKind | null {
  if (isTerminalTabId(tabId)) return "terminal"
  if (isGitTabId(tabId)) return "git"
  if (isEditorTabId(tabId)) return "editor"
  return null
}

export function activeMuxTabInPanel(
  tree: YaadePanelTree,
  panelId: PanelId | null,
): string | null {
  if (!panelId) return null
  const view = tree.getView(panelId)
  if (!view || view.kind !== "tabs") return null
  const id = view.activeTabId
  return muxLeafKind(id) != null ? id : null
}

export function activePtyInPanel(
  tree: YaadePanelTree,
  panelId: PanelId | null,
): string | null {
  const id = activeMuxTabInPanel(tree, panelId)
  return id && isTerminalTabId(id) ? id : null
}

export function listPaneLeaves(tree: YaadePanelTree): MuxLeaf[] {
  const out: MuxLeaf[] = []
  for (const panelId of getAllLeafPanels(tree)) {
    const tabId = activeMuxTabInPanel(tree, panelId)
    if (!tabId) continue
    const kind = muxLeafKind(tabId)
    if (!kind) continue
    out.push({ panelId, ptyTabId: tabId, kind })
  }
  return out
}

export function listTerminalLeaves(tree: YaadePanelTree): MuxLeaf[] {
  return listPaneLeaves(tree).filter(l => l.kind === "terminal")
}

export function placePtyInTree(
  tree: YaadePanelTree,
  tabId: string,
  focused: PanelId | null,
  splitEdge: Edge = "right",
): PanelId {
  const existing = findPanelWithTab(tree, tabId)
  if (existing) {
    tree.setView(existing, paneView(tabId))
    return existing
  }

  const leaves = getAllLeafPanels(tree)
  const anchor =
    (focused && leaves.some(p => p.id === focused.id) ? focused : null) ??
    leaves[0] ??
    (tree.root.kind === "leaf" ? tree.root.panelId : tree.allocPanelId())

  const occupied = activeMuxTabInPanel(tree, anchor) != null
  const target = occupied ? tree.splitAtEdge(anchor, splitEdge) : anchor
  tree.setView(target, paneView(tabId))
  return target
}

export function removePtyFromTree(
  tree: YaadePanelTree,
  panelId: PanelId,
  tabId: string,
): void {
  const view = tree.getView(panelId)
  if (!view || view.kind !== "tabs") return
  if (!panelTabIds(view).includes(tabId)) return
  tree.setView(panelId, popPanelTab(view, tabId))
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
  tabId: string,
  target: PanelId,
  action: DropAction,
): PanelId {
  const existing = findPanelWithTab(tree, tabId)
  if (existing) {
    tree.setView(existing, paneView(tabId))
    return existing
  }

  if (action.kind === "split") {
    const created = tree.splitAtEdge(target, action.edge)
    tree.setView(created, paneView(tabId))
    return created
  }

  const targetTab = activeMuxTabInPanel(tree, target)
  tree.setView(target, paneView(tabId))
  if (targetTab && targetTab !== tabId) {
    const created = tree.splitAtEdge(target, "right")
    tree.setView(created, paneView(targetTab))
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
