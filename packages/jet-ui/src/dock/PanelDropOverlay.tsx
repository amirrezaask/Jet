import { useState, type DragEvent } from "react"
import type { DropAction, Edge, PanelId } from "@jet/shared"
import { TAB_DRAG_MIME, usePanelDrag } from "./PanelDragContext.js"
import { computeDropZone, type DropZone } from "./panel-drop-zones.js"

function zoneStyle(zone: DropZone): React.CSSProperties {
  const base: React.CSSProperties = {
    position: "absolute",
    background: "rgba(56, 139, 253, 0.28)",
    border: "1px solid rgba(56, 139, 253, 0.8)",
    pointerEvents: "none",
  }
  switch (zone) {
    case "center":
      return { ...base, inset: 0 }
    case "left":
      return { ...base, top: 0, bottom: 0, left: 0, width: "50%" }
    case "right":
      return { ...base, top: 0, bottom: 0, right: 0, width: "50%" }
    case "top":
      return { ...base, left: 0, right: 0, top: 0, height: "50%" }
    case "bottom":
      return { ...base, left: 0, right: 0, bottom: 0, height: "50%" }
  }
}

function zoneToAction(zone: DropZone): DropAction {
  if (zone === "center") return { kind: "moveToPane" }
  return { kind: "split", edge: zone as Exclude<Edge, "center"> }
}

export function PanelDropOverlay({
  panelId,
  onTabDrop,
}: {
  panelId: PanelId
  onTabDrop: (
    source: PanelId,
    sourceTabId: string,
    target: PanelId,
    action: DropAction,
  ) => void
}) {
  const drag = usePanelDrag()
  const [zone, setZone] = useState<DropZone | null>(null)

  const tabDrag = drag.tabSource
  if (!tabDrag) return null
  const sameTabPanel = tabDrag.panelId.id === panelId.id
  // When same-panel tab drag is active, disable moveToPane; still allow edge splits (pop into new pane).
  const edgeOnly = sameTabPanel

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return
    const rect = e.currentTarget.getBoundingClientRect()
    const nz = computeDropZone(
      e.clientX - rect.left,
      e.clientY - rect.top,
      rect.width,
      rect.height,
    )
    if (edgeOnly && nz === "center") {
      // Let tab bar handle same-panel reorder.
      setZone(null)
      return
    }
    if (!nz) {
      setZone(null)
      return
    }
    e.preventDefault()
    setZone(nz)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const nz =
      zone ??
      computeDropZone(
        e.clientX - rect.left,
        e.clientY - rect.top,
        rect.width,
        rect.height,
      )
    if (!nz) return
    const action = zoneToAction(nz)
    if (edgeOnly && action.kind === "moveToPane") return
    e.preventDefault()
    setZone(null)
    drag.endTab()
    onTabDrop(tabDrag.panelId, tabDrag.tabId, panelId, action)
  }

  return (
    <div
      style={{ position: "absolute", inset: 0, zIndex: 40 }}
      onDragEnter={e => {
        if (e.dataTransfer.types.includes(TAB_DRAG_MIME)) e.preventDefault()
      }}
      onDragOver={handleDragOver}
      onDragLeave={() => setZone(null)}
      onDrop={handleDrop}
      data-jet-panel-drop-overlay
    >
      {zone ? <div style={zoneStyle(zone)} /> : null}
    </div>
  )
}
