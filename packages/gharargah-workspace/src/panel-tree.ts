import { PanelTree, type PanelNode, type PanelTreeOptions, type PanelTreeSnapshot } from "@gharargah/panels"
import type { DropAction, PanelId, PanelView } from "@gharargah/shared"
import {
  buildTabsView,
  panelHasTab,
  panelHasTabForFile,
  panelTabIds,
  popPanelTab,
} from "./panel-tabs.js"

const GHARARGAH_PANEL_OPTIONS: PanelTreeOptions<PanelView> = {
  emptyView: () => ({ kind: "empty" }),
  isEmpty: view => view.kind === "empty",
}

export class GharargahPanelTree extends PanelTree<PanelView> {
  constructor(root?: PanelNode<PanelView>) {
    super(GHARARGAH_PANEL_OPTIONS, root)
  }

  findEditorPanelForFile(fileUri: string): PanelId | null {
    return this.findPanelWithView(v => panelHasTabForFile(v, fileUri))
  }

  applyTabDrop(
    source: PanelId,
    sourceTabId: string,
    target: PanelId,
    action: DropAction,
  ): { moved: boolean; createdPanel: PanelId | null } {
    const sourceView = this.getView(source)
    if (!sourceView) return { moved: false, createdPanel: null }
    if (action.kind === "moveToPane" && source.id === target.id) {
      return { moved: false, createdPanel: null }
    }

    let movedView: PanelView
    let remainingSourceView: PanelView
    if (sourceView.kind === "tabs") {
      const tabIds = panelTabIds(sourceView)
      if (!tabIds.includes(sourceTabId)) return { moved: false, createdPanel: null }
      movedView = buildTabsView(sourceTabId, [sourceTabId])
      remainingSourceView = popPanelTab(sourceView, sourceTabId)
    } else {
      movedView = sourceView
      remainingSourceView = { kind: "empty" }
    }

    this.setView(source, remainingSourceView)

    if (action.kind === "moveToPane") {
      const targetView = this.getView(target)
      if (movedView.kind === "tabs" && targetView?.kind === "tabs") {
        const tabId = movedView.activeTabId
        const targetTabIds = panelTabIds(targetView).filter(id => id !== tabId)
        if (action.insertIndex !== undefined) {
          const idx = Math.max(0, Math.min(action.insertIndex, targetTabIds.length))
          targetTabIds.splice(idx, 0, tabId)
        } else {
          targetTabIds.push(tabId)
        }
        this.setView(target, buildTabsView(tabId, targetTabIds))
      } else {
        this.setView(target, movedView)
      }
      this.pruneEmptyLeaves()
      return { moved: true, createdPanel: null }
    }
    if (action.kind === "split") {
      const created = this.splitAtEdge(target, action.edge)
      this.setView(created, movedView)
      this.pruneEmptyLeaves()
      return { moved: true, createdPanel: created }
    }
    return { moved: false, createdPanel: null }
  }

  normalizeTabViews(): void {
    this.visitLeaves(node => {
      if (node.view.kind !== "tabs") return
      const tabIds = node.view.tabIds?.length ? node.view.tabIds : [node.view.activeTabId]
      node.view = { kind: "tabs", activeTabId: node.view.activeTabId, tabIds }
    })
  }

  static jetFromJSON(snapshot: PanelTreeSnapshot<PanelView>): GharargahPanelTree {
    const tree = new GharargahPanelTree()
    tree.applySnapshot(snapshot)
    tree.normalizeTabViews()
    return tree
  }

  clone(): GharargahPanelTree {
    return this.cloneInto(new GharargahPanelTree())
  }

  static editorOnlyLayout(): { tree: GharargahPanelTree; editorPanel: PanelId } {
    const tree = new GharargahPanelTree()
    const root = tree.root
    const editorPanel = root.kind === "leaf" ? root.panelId : tree.allocPanelId()
    if (root.kind === "leaf") {
      root.view = { kind: "empty" }
    }
    return { tree, editorPanel }
  }

  static workspaceLayout(): { tree: GharargahPanelTree; sidebarPanel: PanelId; editorPanel: PanelId } {
    const tree = new GharargahPanelTree()
    const sidebarPanel = tree.attachAtViewportEdge("left")
    const root = tree.root
    if (root.kind !== "row") {
      return { tree, sidebarPanel, editorPanel: sidebarPanel }
    }
    const main = root.split.children[1]
    const editorPanel = main?.kind === "leaf" ? main.panelId : sidebarPanel
    return { tree, sidebarPanel, editorPanel }
  }
}
