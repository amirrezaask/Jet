export type PanelId = { id: number }
export type TabId = { id: number }

export function panelId(id: number): PanelId {
  return { id }
}

export function tabId(id: number): TabId {
  return { id }
}

export type Rect = { x: number; y: number; width: number; height: number }

export type Edge = "left" | "right" | "top" | "bottom" | "center"

export type DropAction =
  | { kind: "moveToPane" }
  | { kind: "split"; edge: Edge }
  | { kind: "insertAtBoundary"; parentPath: number[]; beforeChild: number }

export const DRAG_KIND_TAB = 0x7ab
export const DRAG_KIND_PANEL = 0x9a4e

export type TabGroup = {
  tabs: TabId[]
  active: number
}

export type PanelSplit = {
  children: PanelNode[]
  ratios: number[]
}

export type PanelNode =
  | { kind: "leaf"; panelId: PanelId; group: TabGroup }
  | { kind: "row"; split: PanelSplit }
  | { kind: "column"; split: PanelSplit }

export type PanelTreeSnapshot = {
  root: PanelNode
  nextPanelId: number
  nextTabId: number
}

export type SplitterHit = {
  path: number[]
  index: number
  axis: "horizontal" | "vertical"
  rect: Rect
}
