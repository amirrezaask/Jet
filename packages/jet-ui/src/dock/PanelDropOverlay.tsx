import { useState, type DragEvent } from "react"
import type { DropAction, Edge, PanelId } from "@jet/shared"
import { PANEL_DRAG_MIME, usePanelDrag } from "./PanelDragContext.js"

type Zone = Edge | null

const CENTER_HALF = 0.2

function computeZone(x: number, y: number, w: number, h: number): Zone {
  if (w <= 0 || h <= 0) return null
  const nx = x / w - 0.5
  const ny = y / h - 0.5
  if (Math.abs(nx) < CENTER_HALF && Math.abs(ny) < CENTER_HALF) return "center"
  if (Math.abs(nx) > Math.abs(ny)) return nx > 0 ? "right" : "left"
  return ny > 0 ? "bottom" : "top"
}

function zoneStyle(zone: Zone): React.CSSProperties | null {
  if (!zone) return null
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

function zoneToAction(zone: Zone): DropAction | null {
  if (!zone) return null
  if (zone === "center") return { kind: "moveToPane" }
  return { kind: "split", edge: zone }
}

export function PanelDropOverlay({
  panelId,
  onDrop,
}: {
  panelId: PanelId
  onDrop: (source: PanelId, target: PanelId, action: DropAction) => void
}) {
  const drag = usePanelDrag()
  const [zone, setZone] = useState<Zone>(null)

  if (!drag.sourceId) return null
  const sameSource = drag.sourceId.id === panelId.id

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(PANEL_DRAG_MIME)) return
    e.preventDefault()
    if (sameSource) {
      setZone(null)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const nz = computeZone(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height)
    setZone(nz)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const source = drag.sourceId
    const action = zoneToAction(zone)
    setZone(null)
    drag.end()
    if (!source || !action || sameSource) return
    onDrop(source, panelId, action)
  }

  return (
    <div
      style={{ position: "absolute", inset: 0, zIndex: 40 }}
      onDragEnter={e => {
        if (e.dataTransfer.types.includes(PANEL_DRAG_MIME)) e.preventDefault()
      }}
      onDragOver={handleDragOver}
      onDragLeave={() => setZone(null)}
      onDrop={handleDrop}
      data-jet-panel-drop-overlay
    >
      {zone ? <div style={zoneStyle(zone)!} /> : null}
    </div>
  )
}
