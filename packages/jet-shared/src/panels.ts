export type PanelId = { id: number }

export function panelId(id: number): PanelId {
  return { id }
}

export type Edge = "left" | "right" | "top" | "bottom" | "center"

export type DropAction =
  | { kind: "moveToPane"; insertIndex?: number }
  | { kind: "split"; edge: Edge }
  | { kind: "insertAtBoundary"; parentPath: number[]; beforeChild: number }

/** Jet-specific view union. The generic PanelTree lives in @jet/panels and is parameterized by this shape. */
export type PanelView =
  | { kind: "empty" }
  | { kind: "editor"; fileUri: string; buffers?: string[] }
  | { kind: "explorer" }
  | { kind: "locationlist" }
  | { kind: "output" }

export const DRAG_KIND_TAB = 0x7ab
export const DRAG_KIND_PANEL = 0x9a4e
