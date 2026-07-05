import type { DropAction, PanelId } from "@jet/shared"

export type PanelEvent =
  | { type: "splitRatiosChanged"; path: number[]; ratios: number[] }
  | { type: "panelClose"; panelId: PanelId }
  | { type: "panelDrop"; source: PanelId; target: PanelId; action: DropAction }
