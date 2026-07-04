import type { PanelId, Rect } from "@jet/shared"

export type PanelEvent =
  | { type: "splitResized"; path: number[]; splitterIndex: number; deltaPx: number; viewport: Rect }
  | { type: "splitRatiosChanged"; path: number[]; ratios: number[] }
  | { type: "panelClose"; panelId: PanelId }
