import type { DropAction, Edge, PanelId, TabId } from "@jet/shared"

export type PanelEvent =
  | { type: "tabSelect"; panelId: PanelId; tabId: TabId }
  | { type: "tabClose"; tabId: TabId }
  | { type: "tabMoved"; tabId: TabId; targetPanelId: PanelId; action: DropAction; insertIndex?: number }
  | { type: "splitResized"; path: number[]; splitterIndex: number; deltaPx: number }
  | { type: "panelClose"; panelId: PanelId }

export type TabDragState = {
  tabId: TabId
  sourcePanelId: PanelId
}

export type DropSite = {
  panelId: PanelId
  action: DropAction
  rect: { x: number; y: number; width: number; height: number }
}

export function dropSitesForPanel(
  panelRect: { x: number; y: number; width: number; height: number },
  panelId: PanelId,
): DropSite[] {
  const { x, y, width, height } = panelRect
  const cx = x + width / 2
  const cy = y + height / 2
  const zone = Math.min(width, height) * 0.25

  const sites: DropSite[] = [
    {
      panelId,
      action: { kind: "moveToPane" },
      rect: { x: cx - zone / 2, y: cy - zone / 2, width: zone, height: zone },
    },
  ]

  const edges: Edge[] = ["left", "right", "top", "bottom"]
  for (const edge of edges) {
    let rect = { x, y, width, height: zone }
    if (edge === "left") rect = { x, y, width: zone, height }
    if (edge === "right") rect = { x: x + width - zone, y, width: zone, height }
    if (edge === "top") rect = { x, y, width, height: zone }
    if (edge === "bottom") rect = { x, y: y + height - zone, width, height: zone }
    sites.push({ panelId, action: { kind: "split", edge }, rect })
  }

  return sites
}
