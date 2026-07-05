import { createContext, useContext, useMemo, useState, type ReactNode } from "react"
import type { PanelId } from "@jet/shared"

export const PANEL_DRAG_MIME = "application/x-jet-panel"

type PanelDragState = {
  sourceId: PanelId | null
  start: (id: PanelId) => void
  end: () => void
}

const Ctx = createContext<PanelDragState | null>(null)

export function PanelDragProvider({ children }: { children: ReactNode }) {
  const [sourceId, setSourceId] = useState<PanelId | null>(null)
  const value = useMemo<PanelDragState>(
    () => ({
      sourceId,
      start: id => setSourceId(id),
      end: () => setSourceId(null),
    }),
    [sourceId],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePanelDrag(): PanelDragState {
  const v = useContext(Ctx)
  if (!v) throw new Error("usePanelDrag must be inside PanelDragProvider")
  return v
}
