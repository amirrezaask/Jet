import { PanelTree, type PanelNode, type PanelTreeOptions, type PanelTreeSnapshot } from "@jet/panels"
import type { DropAction, PanelId, PanelView } from "@jet/shared"

const JET_PANEL_OPTIONS: PanelTreeOptions<PanelView> = {
  emptyView: () => ({ kind: "empty" }),
  isEmpty: view => view.kind === "empty",
}

/** Jet-specific PanelTree factory + helpers layered on the generic tree. */
export class JetPanelTree extends PanelTree<PanelView> {
  constructor(root?: PanelNode<PanelView>) {
    super(JET_PANEL_OPTIONS, root)
  }

  findEditorPanelForFile(fileUri: string): PanelId | null {
    return this.findPanelWithView(
      v => v.kind === "editor" && (v.buffers ?? [v.fileUri]).includes(fileUri),
    )
  }

  /**
   * Apply a drag-drop action moving the view from `source` onto `target`.
   * - moveToPane: overwrite target with source view, close source.
   * - split(edge): create new leaf on that edge of target, move source view into it, close source.
   * No-op when source === target or either panel is missing.
   */
  applyDrop(source: PanelId, target: PanelId, action: DropAction): boolean {
    if (source.id === target.id) return false
    const sourceView = this.getView(source)
    const targetView = this.getView(target)
    if (sourceView == null || targetView == null) return false

    if (action.kind === "moveToPane") {
      this.setView(target, sourceView)
      this.closePanel(source)
      this.pruneEmptyLeaves()
      return true
    }
    if (action.kind === "split") {
      const created = this.splitAtEdge(target, action.edge)
      this.setView(created, sourceView)
      this.closePanel(source)
      this.pruneEmptyLeaves()
      return true
    }
    return false
  }

  /** Ensure editor leaves have buffers[] for legacy snapshots. */
  normalizeEditorViews(): void {
    this.visitLeaves(node => {
      if (node.view.kind !== "editor") return
      const buffers = node.view.buffers?.length ? node.view.buffers : [node.view.fileUri]
      node.view = { kind: "editor", fileUri: node.view.fileUri, buffers }
    })
  }

  static jetFromJSON(snapshot: PanelTreeSnapshot<PanelView>): JetPanelTree {
    const tree = new JetPanelTree(snapshot.root)
    ;(tree as unknown as { nextPanelId: number }).nextPanelId = snapshot.nextPanelId
    tree.normalizeEditorViews()
    return tree
  }

  static editorOnlyLayout(): { tree: JetPanelTree; editorPanel: PanelId } {
    const tree = new JetPanelTree()
    const root = tree.root
    const editorPanel = root.kind === "leaf" ? root.panelId : tree.allocPanelId()
    if (root.kind === "leaf") {
      root.view = { kind: "empty" }
    }
    return { tree, editorPanel }
  }

  static workspaceLayout(): { tree: JetPanelTree; sidebarPanel: PanelId; editorPanel: PanelId } {
    const tree = new JetPanelTree()
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
