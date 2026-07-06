import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { arrayMove } from "@dnd-kit/sortable"
import type { DropAction, PanelId } from "@jet/shared"
import { JetTabDragGhost } from "@/motion/JetOverlayMotion.js"
import type { DropSiteKind } from "./panel-drop-zones.js"
import { hitTestSites, siteToAction, type DropSite } from "./panel-drop-zones.js"
import {
  parseDropDndId,
  parseTabBarDndId,
  parseTabDndId,
  type TabDragData,
} from "./tab-dnd-types.js"
import { PanelDragProvider, usePanelDrag } from "./PanelDragContext.js"

export type TabDndHandlers = {
  onTabReorder: (panelId: PanelId, tabId: string, toIndex: number) => void
  onTabDrop: (
    source: PanelId,
    sourceTabId: string,
    target: PanelId,
    action: DropAction,
  ) => void
  /** Tab ids per panel for reorder index math. */
  tabIdsForPanel: (panelId: PanelId) => string[]
}

type TabDndInnerProps = {
  children: ReactNode
  handlers: TabDndHandlers
}

type DropHotState = {
  panelId: PanelId
  zone: DropSiteKind
  preview: DropSite["preview"]
} | null

const HotDropCtx = createContext<DropHotState>(null)

export function useDropHot(): DropHotState {
  return useContext(HotDropCtx)
}

function TabDndInner({ children, handlers }: TabDndInnerProps) {
  const drag = usePanelDrag()
  const [activeTab, setActiveTab] = useState<TabDragData | null>(null)
  const [dropHot, setDropHot] = useState<DropHotState>(null)
  const dropHotRef = useRef<DropHotState>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      const data = event.active.data.current as TabDragData | undefined
      if (!data || data.type !== "tab") return
      setActiveTab(data)
      drag.startTab({ panelId: data.panelId, tabId: data.tabId })
    },
    [drag],
  )

  const onDragMove = useCallback((event: DragMoveEvent) => {
    const activator = event.activatorEvent
    if (!activator || !("clientX" in activator)) {
      setDropHot(null)
      return
    }
    const cx = (activator as PointerEvent).clientX + event.delta.x
    const cy = (activator as PointerEvent).clientY + event.delta.y
    const overlays = document.querySelectorAll<HTMLElement>("[data-jet-panel-drop-overlay]")
    let best: DropHotState = null
    for (const overlay of overlays) {
      const rect = overlay.getBoundingClientRect()
      if (cx < rect.left || cx > rect.right || cy < rect.top || cy > rect.bottom) continue
      const sitesRaw = overlay.dataset.jetDropSites
      if (!sitesRaw) continue
      const panelId = Number(overlay.dataset.jetDropPanel)
      if (!Number.isFinite(panelId)) continue
      const sites = JSON.parse(sitesRaw) as DropSite[]
      const mx = cx - rect.left
      const my = cy - rect.top
      const hit = hitTestSites(mx, my, sites)
      if (hit) {
        best = { panelId: { id: panelId }, zone: hit.id, preview: hit.preview }
        break
      }
    }
    setDropHot(best)
    dropHotRef.current = best
  }, [])

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const data = event.active.data.current as TabDragData | undefined
      const hot = dropHotRef.current
      setActiveTab(null)
      setDropHot(null)
      dropHotRef.current = null
      drag.endTab()
      if (!data || data.type !== "tab") return

      const overId = event.over ? String(event.over.id) : null

      if (hot && data.panelId.id !== hot.panelId.id) {
        handlers.onTabDrop(data.panelId, data.tabId, hot.panelId, siteToAction(hot.zone))
        return
      }

      if (hot && data.panelId.id === hot.panelId.id && hot.zone !== "center") {
        handlers.onTabDrop(data.panelId, data.tabId, hot.panelId, siteToAction(hot.zone))
        return
      }

      if (!overId) return

      const dropTarget = parseDropDndId(overId)
      if (dropTarget) {
        handlers.onTabDrop(
          data.panelId,
          data.tabId,
          dropTarget.panelId,
          siteToAction(dropTarget.zone),
        )
        return
      }

      const tabBarTarget = parseTabBarDndId(overId)
      if (tabBarTarget) {
        if (tabBarTarget.id === data.panelId.id) return
        handlers.onTabDrop(data.panelId, data.tabId, tabBarTarget, { kind: "moveToPane" })
        return
      }

      const tabTarget = parseTabDndId(overId)
      if (!tabTarget) return

      if (tabTarget.panelId.id === data.panelId.id) {
        const ids = handlers.tabIdsForPanel(data.panelId)
        const oldIndex = ids.indexOf(data.tabId)
        const newIndex = ids.indexOf(tabTarget.tabId)
        if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
        const next = arrayMove(ids, oldIndex, newIndex)
        handlers.onTabReorder(data.panelId, data.tabId, next.indexOf(data.tabId))
        return
      }

      const targetIds = handlers.tabIdsForPanel(tabTarget.panelId)
      const insertIndex = targetIds.indexOf(tabTarget.tabId)
      handlers.onTabDrop(data.panelId, data.tabId, tabTarget.panelId, {
        kind: "moveToPane",
        insertIndex: insertIndex >= 0 ? insertIndex : undefined,
      })
    },
    [drag, handlers],
  )

  const onDragCancel = useCallback(() => {
    setActiveTab(null)
    setDropHot(null)
    dropHotRef.current = null
    drag.endTab()
  }, [drag])

  return (
    <HotDropCtx.Provider value={dropHot}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        {children}
        <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }}>
          {activeTab ? (
            <JetTabDragGhost label={activeTab.label} dirty={activeTab.dirty} />
          ) : null}
        </DragOverlay>
      </DndContext>
    </HotDropCtx.Provider>
  )
}

export function TabDndRoot({
  children,
  handlers,
}: {
  children: ReactNode
  handlers: TabDndHandlers
}) {
  return (
    <PanelDragProvider>
      <TabDndInner handlers={handlers}>{children}</TabDndInner>
    </PanelDragProvider>
  )
}
