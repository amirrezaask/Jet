import { PanelTree, type PanelNode, type PanelTreeOptions, type PanelTreeSnapshot } from "@jet/panels"
import type { DropAction, PanelId, PanelView } from "@jet/shared"
import { buildEditorView, editorBuffers, popPanelBufferView } from "./panel-buffers.js"

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
   * Apply a tab-level drag/drop moving buffer `sourceUri` from `source` panel onto `target` panel.
   *
   * Editor sources: `sourceUri` selects a buffer within the source's buffer stack.
   * Non-editor sources (explorer/locationlist/output/empty): the whole view moves; `sourceUri`
   * is ignored (pass the view's tab id or empty string).
   *
   * Semantics:
   * - moveToPane: merge into target. Editor→editor merges buffer stacks; optional insertIndex
   *   splices at tab-bar position, otherwise appends (center overlay merge). Editor→other
   *   or other→any replaces the target's view (single-tab semantics; non-editor panels don't stack).
   * - split(edge): create new pane on that edge of target, place moved view alone there.
   * Same source+target `moveToPane` is a no-op; same source+target `split` pops the tab into new pane.
   * Returns { moved, createdPanel? }.
   */
  applyTabDrop(
    source: PanelId,
    sourceUri: string,
    target: PanelId,
    action: DropAction,
  ): { moved: boolean; createdPanel: PanelId | null } {
    const sourceView = this.getView(source)
    if (!sourceView) return { moved: false, createdPanel: null }
    if (action.kind === "moveToPane" && source.id === target.id) {
      return { moved: false, createdPanel: null }
    }

    // Compute the view we're moving + what remains on the source.
    let movedView: PanelView
    let remainingSourceView: PanelView
    if (sourceView.kind === "editor") {
      const buffers = editorBuffers(sourceView)
      if (!buffers.includes(sourceUri)) return { moved: false, createdPanel: null }
      movedView = buildEditorView(sourceUri, [sourceUri])
      remainingSourceView = popPanelBufferView(sourceView, sourceUri)
    } else {
      // Non-editor single-tab view: whole view moves; source becomes empty.
      movedView = sourceView
      remainingSourceView = { kind: "empty" }
    }

    this.setView(source, remainingSourceView)

    if (action.kind === "moveToPane") {
      const targetView = this.getView(target)
      if (movedView.kind === "editor" && targetView?.kind === "editor") {
        const uri = movedView.fileUri
        const targetBuffers = editorBuffers(targetView).filter(u => u !== uri)
        if (action.insertIndex !== undefined) {
          const idx = Math.max(0, Math.min(action.insertIndex, targetBuffers.length))
          targetBuffers.splice(idx, 0, uri)
        } else {
          targetBuffers.push(uri)
        }
        this.setView(target, { kind: "editor", fileUri: uri, buffers: targetBuffers })
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
