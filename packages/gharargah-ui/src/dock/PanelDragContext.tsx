import { createContext, useContext, useMemo, useState, type ReactNode } from "react"
import type { PanelId } from "@gharargah/shared"

export type TabDragSource = { panelId: PanelId; tabId: string }

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
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePanelDrag(): PanelDragState {
  const v = useContext(Ctx)
  if (!v) throw new Error("usePanelDrag must be inside PanelDragProvider")
  return v
}
