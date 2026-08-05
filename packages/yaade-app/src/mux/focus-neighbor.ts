import type { PanelId } from "@yaade/shared"
import type { MuxTerminalSlotBox } from "./MuxTerminalLayer.js"

export type FocusDirection = "left" | "right" | "up" | "down"

type PaneRect = {
  panelId: PanelId
  ptyTabId: string
  box: MuxTerminalSlotBox
}

/**
 * Geometric neighbour of the focused pane using slot boxes.
 * Prefers the closest pane whose center lies primarily in `direction`.
 */
export function findFocusNeighbor(
  panes: PaneRect[],
  focusedPanelId: PanelId | null,
  direction: FocusDirection,
): PaneRect | null {
  if (!focusedPanelId || panes.length < 2) return null
  const current = panes.find(p => p.panelId.id === focusedPanelId.id)
  if (!current) return null

  const cx = current.box.left + current.box.width / 2
  const cy = current.box.top + current.box.height / 2

  let best: PaneRect | null = null
  let bestScore = Number.POSITIVE_INFINITY

  for (const candidate of panes) {
    if (candidate.panelId.id === current.panelId.id) continue
    const ox = candidate.box.left + candidate.box.width / 2
    const oy = candidate.box.top + candidate.box.height / 2
    const dx = ox - cx
    const dy = oy - cy

    let primary = 0
    let secondary = 0
    switch (direction) {
      case "left":
        if (dx >= -1) continue
        primary = -dx
        secondary = Math.abs(dy)
        break
      case "right":
        if (dx <= 1) continue
        primary = dx
        secondary = Math.abs(dy)
        break
      case "up":
        if (dy >= -1) continue
        primary = -dy
        secondary = Math.abs(dx)
        break
      case "down":
        if (dy <= 1) continue
        primary = dy
        secondary = Math.abs(dx)
        break
    }
    // Prefer candidates primarily aligned with the direction.
    const score = primary + secondary * 0.35
    if (score < bestScore) {
      bestScore = score
      best = candidate
    }
  }
  return best
}
