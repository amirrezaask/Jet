import {
  type DropAction,
  type Edge,
  type PanelId,
  type PanelNode,
  type PanelSplit,
  type PanelTreeSnapshot,
  type PanelView,
  type Rect,
  type SplitterHit,
  panelId,
} from "@jet/shared"

const MIN_PANEL = 48
const SPLITTER = 4

const emptyView = (): PanelView => ({ kind: "empty" })

export class PanelTree {
  root: PanelNode
  private nextPanelId = 1

  constructor(root?: PanelNode) {
    this.root =
      root ??
      ({
        kind: "leaf",
        panelId: panelId(1),
        view: emptyView(),
      } satisfies PanelNode)
    if (!root) this.nextPanelId = 2
  }

  allocPanelId(): PanelId {
    return panelId(this.nextPanelId++)
  }

  setView(panel: PanelId, view: PanelView): void {
    this.visitLeaves(node => {
      if (node.panelId.id !== panel.id) return
      node.view = view
    })
  }

  getView(panel: PanelId): PanelView | null {
    const leaf = this.getLeaf(panel)
    return leaf?.view ?? null
  }

  findPanelWithView(predicate: (view: PanelView) => boolean): PanelId | null {
    let found: PanelId | null = null
    this.visitLeaves(node => {
      if (found) return
      if (predicate(node.view)) found = node.panelId
    })
    return found
  }

  findEditorPanelForFile(fileUri: string): PanelId | null {
    return this.findPanelWithView(v => v.kind === "editor" && v.fileUri === fileUri)
  }

  splitAtEdge(panel: PanelId, edge: Edge): PanelId {
    const newPanelId = this.allocPanelId()
    const newLeaf: PanelNode = {
      kind: "leaf",
      panelId: newPanelId,
      view: emptyView(),
    }

    const replace = (node: PanelNode, path: number[]): PanelNode => {
      if (node.kind !== "leaf" || node.panelId.id !== panel.id) return node

      const horizontal = edge === "left" || edge === "right"
      const kind = horizontal ? "row" : "column"
      const first = edge === "right" || edge === "bottom" ? node : newLeaf
      const second = edge === "right" || edge === "bottom" ? newLeaf : node

      return {
        kind,
        split: {
          children: [first, second],
          ratios: [0.5, 0.5],
        },
      } satisfies PanelNode
    }

    this.root = this.mapNode(this.root, [], replace)
    return newPanelId
  }

  closePanel(panel: PanelId): void {
    this.root = this.removePanel(this.root, panel) ?? this.createDefaultLeaf()
  }

  computeRects(viewport: Rect): Map<number, Rect> {
    const map = new Map<number, Rect>()
    this.layoutNode(this.root, viewport, map)
    return map
  }

  splitterHits(viewport: Rect): SplitterHit[] {
    const hits: SplitterHit[] = []
    this.collectSplitters(this.root, viewport, [], hits)
    return hits
  }

  resizeSplit(path: number[], splitterIndex: number, deltaPx: number, viewport: Rect): void {
    const node = this.getAtPath(this.root, path)
    if (!node || node.kind === "leaf") return
    const split = node.split
    const axis = node.kind === "row" ? "horizontal" : "vertical"
    const total = axis === "horizontal" ? viewport.width : viewport.height
    const i = splitterIndex
    if (i < 0 || i >= split.ratios.length - 1) return
    const deltaRatio = deltaPx / total
    const a = split.ratios[i]! + deltaRatio
    const b = split.ratios[i + 1]! - deltaRatio
    const minRatio = MIN_PANEL / total
    if (a < minRatio || b < minRatio) return
    split.ratios[i] = a
    split.ratios[i + 1] = b
    this.normalizeRatios(split.ratios)
  }

  attachAtViewportEdge(edge: Edge): PanelId {
    const newPanelId = this.allocPanelId()
    const newLeaf: PanelNode = {
      kind: "leaf",
      panelId: newPanelId,
      view: emptyView(),
    }
    const kind = edge === "left" || edge === "right" ? "row" : "column"
    const first = edge === "right" || edge === "bottom" ? this.root : newLeaf
    const second = edge === "right" || edge === "bottom" ? newLeaf : this.root
    this.root = {
      kind,
      split: { children: [first, second], ratios: edge === "left" || edge === "top" ? [0.22, 0.78] : [0.78, 0.22] },
    }
    return newPanelId
  }

  /** Remove empty leaves when more than one leaf exists. */
  pruneEmptyLeaves(): void {
    for (let guard = 0; guard < 64; guard++) {
      let leafCount = 0
      const empty: PanelId[] = []
      this.visitLeaves(node => {
        leafCount++
        if (node.view.kind === "empty") empty.push(node.panelId)
      })
      if (empty.length === 0 || leafCount <= 1) break
      for (const panel of empty) this.closePanel(panel)
    }
  }

  getLeaf(panel: PanelId): { panelId: PanelId; view: PanelView } | null {
    let leaf: { panelId: PanelId; view: PanelView } | null = null
    this.visitLeaves(node => {
      if (node.panelId.id === panel.id) leaf = node
    })
    return leaf
  }

  toJSON(): PanelTreeSnapshot {
    return {
      root: structuredClone(this.root),
      nextPanelId: this.nextPanelId,
    }
  }

  static fromJSON(snapshot: PanelTreeSnapshot): PanelTree {
    const tree = new PanelTree(snapshot.root)
    tree.nextPanelId = snapshot.nextPanelId
    return tree
  }

  static defaultLayout(): PanelTree {
    return PanelTree.editorOnlyLayout().tree
  }

  static editorOnlyLayout(): { tree: PanelTree; editorPanel: PanelId } {
    const tree = new PanelTree()
    const root = tree.root
    const editorPanel = root.kind === "leaf" ? root.panelId : tree.allocPanelId()
    if (root.kind === "leaf") {
      root.view = { kind: "empty" }
    }
    return { tree, editorPanel }
  }

  static workspaceLayout(): { tree: PanelTree; sidebarPanel: PanelId; editorPanel: PanelId } {
    const tree = new PanelTree()
    const sidebarPanel = tree.attachAtViewportEdge("left")
    const root = tree.root
    if (root.kind !== "row") {
      return { tree, sidebarPanel, editorPanel: sidebarPanel }
    }
    const main = root.split.children[1]
    const editorPanel = main?.kind === "leaf" ? main.panelId : sidebarPanel
    return { tree, sidebarPanel, editorPanel }
  }

  private createDefaultLeaf(): PanelNode {
    const id = this.allocPanelId()
    return { kind: "leaf", panelId: id, view: emptyView() }
  }

  private visitLeaves(fn: (node: Extract<PanelNode, { kind: "leaf" }>) => void): void {
    const walk = (node: PanelNode) => {
      if (node.kind === "leaf") fn(node)
      else node.split.children.forEach(walk)
    }
    walk(this.root)
  }

  private mapNode(
    node: PanelNode,
    path: number[],
    replace: (node: PanelNode, path: number[]) => PanelNode,
  ): PanelNode {
    const replaced = replace(node, path)
    if (replaced !== node) return replaced
    if (replaced.kind === "leaf") return replaced
    return {
      ...replaced,
      split: {
        ...replaced.split,
        children: replaced.split.children.map((c, i) => this.mapNode(c, [...path, i], replace)),
      },
    }
  }

  private removePanel(node: PanelNode, panel: PanelId): PanelNode | null {
    if (node.kind === "leaf") {
      return node.panelId.id === panel.id ? null : node
    }
    const children = node.split.children
      .map(c => this.removePanel(c, panel))
      .filter((c): c is PanelNode => c != null)
    if (children.length === 0) return null
    if (children.length === 1) return children[0]!
    return {
      kind: node.kind,
      split: { children, ratios: this.rebalanceRatios(children.length) },
    }
  }

  private rebalanceRatios(n: number): number[] {
    return Array.from({ length: n }, () => 1 / n)
  }

  private normalizeRatios(ratios: number[]): void {
    const sum = ratios.reduce((a, b) => a + b, 0)
    for (let i = 0; i < ratios.length; i++) ratios[i]! /= sum
  }

  private layoutNode(node: PanelNode, rect: Rect, map: Map<number, Rect>): void {
    if (node.kind === "leaf") {
      map.set(node.panelId.id, rect)
      return
    }
    const { children, ratios } = node.split
    const horizontal = node.kind === "row"
    let offset = horizontal ? rect.x : rect.y
    const total = horizontal ? rect.width : rect.height
    const available = total - SPLITTER * (children.length - 1)

    children.forEach((child, i) => {
      const size = available * ratios[i]!
      const childRect: Rect = horizontal
        ? { x: offset, y: rect.y, width: size, height: rect.height }
        : { x: rect.x, y: offset, width: rect.width, height: size }
      this.layoutNode(child, childRect, map)
      offset += size + SPLITTER
    })
  }

  private collectSplitters(
    node: PanelNode,
    rect: Rect,
    path: number[],
    hits: SplitterHit[],
  ): void {
    if (node.kind === "leaf") return
    const horizontal = node.kind === "row"
    const { children, ratios } = node.split
    let offset = horizontal ? rect.x : rect.y
    const total = horizontal ? rect.width : rect.height
    const available = total - SPLITTER * (children.length - 1)

    children.forEach((child, i) => {
      const size = available * ratios[i]!
      if (i < children.length - 1) {
        const splitRect: Rect = horizontal
          ? { x: offset + size, y: rect.y, width: SPLITTER, height: rect.height }
          : { x: rect.x, y: offset + size, width: rect.width, height: SPLITTER }
        hits.push({
          path: [...path],
          index: i,
          axis: horizontal ? "horizontal" : "vertical",
          rect: splitRect,
        })
      }
      const childRect: Rect = horizontal
        ? { x: offset, y: rect.y, width: size, height: rect.height }
        : { x: rect.x, y: offset, width: rect.width, height: size }
      this.collectSplitters(child, childRect, [...path, i], hits)
      offset += size + SPLITTER
    })
  }

  private getAtPath(node: PanelNode, path: number[]): PanelNode | null {
    let current: PanelNode = node
    for (const idx of path) {
      if (current.kind === "leaf") return null
      current = current.split.children[idx]!
      if (!current) return null
    }
    return current
  }
}

export * from "./events.js"
