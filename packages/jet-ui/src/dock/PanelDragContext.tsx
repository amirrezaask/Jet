import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import type { PanelId } from "@jet/shared"

export const TAB_DRAG_MIME = "application/x-jet-tab"

export type TabDragSource = { panelId: PanelId; uri: string }

type PanelDragState = {
  tabSource: TabDragSource | null
  startTab: (src: TabDragSource) => void
  endTab: () => void
}

const Ctx = createContext<PanelDragState | null>(null)

export function PanelDragProvider({ children }: { children: ReactNode }) {
  const [tabSource, setTabSource] = useState<TabDragSource | null>(null)
  const value = useMemo<PanelDragState>(
    () => ({
      tabSource,
      startTab: src => setTabSource(src),
      endTab: () => setTabSource(null),
    }),
    [tabSource],
  )
  // Window-level dragover: preventDefault for tab MIME so drop stays enabled
  // even in a frame where the overlay hasn't mounted yet.
  useEffect(() => {
    if (!tabSource) return
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes(TAB_DRAG_MIME)) {
        e.preventDefault()
      }
    }
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes(TAB_DRAG_MIME)) {
        // Prevent default browser behavior (navigation) if drop escapes app zones.
        e.preventDefault()
      }
    }
    const onDragEnd = () => setTabSource(null)
    window.addEventListener("dragover", onDragOver, true)
    window.addEventListener("drop", onDrop, true)
    window.addEventListener("dragend", onDragEnd, true)
    return () => {
      window.removeEventListener("dragover", onDragOver, true)
      window.removeEventListener("drop", onDrop, true)
      window.removeEventListener("dragend", onDragEnd, true)
    }
  }, [tabSource])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePanelDrag(): PanelDragState {
  const v = useContext(Ctx)
  if (!v) throw new Error("usePanelDrag must be inside PanelDragProvider")
  return v
}
