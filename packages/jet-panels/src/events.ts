import type { DropAction, PanelId } from "@jet/shared"

export type PanelEvent =
  | { type: "splitRatiosChanged"; path: number[]; ratios: number[] }
  | { type: "panelClose"; panelId: PanelId }
  | { type: "tabDrop"; source: PanelId; sourceUri: string; target: PanelId; action: DropAction }
  | { type: "tabReorder"; panelId: PanelId; uri: string; toIndex: number }
  | { type: "tabActivate"; panelId: PanelId; uri: string }
  | { type: "tabClose"; panelId: PanelId; uri: string }
