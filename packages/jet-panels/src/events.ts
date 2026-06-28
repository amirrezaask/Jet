import type { DropAction, Edge, PanelId, Rect, TabId } from "@jet/shared"

export type PanelEvent =
  | { type: "tabSelect"; panelId: PanelId; tabId: TabId }
  | { type: "tabClose"; tabId: TabId }
  | { type: "tabMoved"; tabId: TabId; targetPanelId: PanelId; action: DropAction; insertIndex?: number }
  | { type: "splitResized"; path: number[]; splitterIndex: number; deltaPx: number; viewport: Rect }
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

function pointInRect(
  x: number,
  y: number,
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height
}

const DRAG_AXIS_RATIO = 1.5

function pickEdge(
  dL: number,
  dR: number,
  dT: number,
  dB: number,
  dragDx?: number,
  dragDy?: number,
): Edge {
  if (dragDx !== undefined && dragDy !== undefined) {
    const absDx = Math.abs(dragDx)
    const absDy = Math.abs(dragDy)
    if (absDx > absDy * DRAG_AXIS_RATIO) return dL <= dR ? "left" : "right"
    if (absDy > absDx * DRAG_AXIS_RATIO) return dT <= dB ? "top" : "bottom"
  }
  const min = Math.min(dL, dR, dT, dB)
  if (min === dL) return "left"
  if (min === dR) return "right"
  if (min === dT) return "top"
  return "bottom"
}

function inSplitEdgeZone(
  dL: number,
  dR: number,
  dT: number,
  dB: number,
  width: number,
  height: number,
): boolean {
  const hZone = width * 0.25
  const vZone = height * 0.25
  return dL <= hZone || dR <= hZone || dT <= vZone || dB <= vZone
}

export type ResolveDropOptions = {
  dragDx?: number
  dragDy?: number
}

export function resolveDropAtPoint(
  x: number,
  y: number,
  rects: Map<number, Rect>,
  opts?: ResolveDropOptions,
): { panelId: PanelId; action: DropAction } | null {
  for (const [panelNum, panelRect] of rects) {
    if (!pointInRect(x, y, panelRect)) continue
    const panelId = { id: panelNum }
    const dL = x - panelRect.x
    const dR = panelRect.x + panelRect.width - x
    const dT = y - panelRect.y
    const dB = panelRect.y + panelRect.height - y
    if (!inSplitEdgeZone(dL, dR, dT, dB, panelRect.width, panelRect.height)) {
      return { panelId, action: { kind: "moveToPane" } }
    }
    const edge = pickEdge(dL, dR, dT, dB, opts?.dragDx, opts?.dragDy)
    return { panelId, action: { kind: "split", edge } }
  }
  return null
}

export function dropSiteMatchesAction(site: DropSite, hit: { panelId: PanelId; action: DropAction }): boolean {
  if (site.panelId.id !== hit.panelId.id) return false
  if (site.action.kind !== hit.action.kind) return false
  if (site.action.kind === "split" && hit.action.kind === "split") {
    return site.action.edge === hit.action.edge
  }
  return true
}
