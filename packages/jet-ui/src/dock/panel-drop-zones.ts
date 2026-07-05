import type { Edge } from "@jet/shared"

/** Split edge or center merge zone — matches VS Code editorDropTarget.positionOverlay. */
export type DropZone = Exclude<Edge, never>

export type ComputeDropZoneOptions = {
  /** VS Code openSideBySideDirection === 'right' (default). */
  preferSplitVertically?: boolean
  /** When false, entire area is center merge (no splits). */
  enableSplitting?: boolean
}

/**
 * Map pointer position within a panel body to a drop zone.
 * Ported from VS Code editorDropTarget.ts positionOverlay().
 */
export function computeDropZone(
  mouseX: number,
  mouseY: number,
  width: number,
  height: number,
  options: ComputeDropZoneOptions = {},
): DropZone | null {
  if (width <= 0 || height <= 0) return null

  const { preferSplitVertically = true, enableSplitting = true } = options

  const edgeWidthThresholdFactor = enableSplitting ? 0.1 : 0
  const edgeHeightThresholdFactor = enableSplitting ? 0.1 : 0

  const edgeWidthThreshold = width * edgeWidthThresholdFactor
  const edgeHeightThreshold = height * edgeHeightThresholdFactor

  const splitWidthThreshold = width / 3
  const splitHeightThreshold = height / 3

  const inCenter =
    mouseX > edgeWidthThreshold &&
    mouseX < width - edgeWidthThreshold &&
    mouseY > edgeHeightThreshold &&
    mouseY < height - edgeHeightThreshold

  if (inCenter || !enableSplitting) {
    return inCenter ? "center" : null
  }

  if (preferSplitVertically) {
    if (mouseX < splitWidthThreshold) return "left"
    if (mouseX > splitWidthThreshold * 2) return "right"
    return mouseY < height / 2 ? "top" : "bottom"
  }

  if (mouseY < splitHeightThreshold) return "top"
  if (mouseY > splitHeightThreshold * 2) return "bottom"
  return mouseX < width / 2 ? "left" : "right"
}
