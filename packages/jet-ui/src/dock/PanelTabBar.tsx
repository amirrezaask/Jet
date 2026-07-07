import { memo, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react"
import { useDroppable } from "@dnd-kit/core"
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { XIcon } from "lucide-react"
import type { DropAction, PanelId, PanelView } from "@jet/shared"
import { Button } from "@/components/ui/button.js"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.js"
import { usePanelDrag } from "./PanelDragContext.js"
import { tabBarDndId, tabDndId, type TabDragData } from "./tab-dnd-types.js"
import type { TabStore, TabTypeRegistry } from "../tabs/registry.js"
import { cn } from "@/lib/utils.js"

export type PanelTab = {
  id: string
  label: string
  dirty?: boolean
  closable: boolean
  icon?: ReactNode
}

export function tabIdsOf(view: PanelView): { tabIds: string[]; activeId: string } {
  if (view.kind !== "tabs") return { tabIds: [], activeId: "" }
  const tabIds = view.tabIds.length ? view.tabIds : [view.activeTabId]
  return { tabIds, activeId: view.activeTabId }
}

function shallowSameTabs(a: PanelTab[], b: PanelTab[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x.id !== y.id || x.label !== y.label || x.dirty !== y.dirty || x.icon !== y.icon) {
      return false
    }
  }
  return true
}

function useTabsSnapshot(store: TabStore, tabIds: string[]): PanelTab[] {
  const cacheRef = useRef<PanelTab[]>([])
  const tabIdsKey = tabIds.join("|")
  const tabIdsRef = useRef(tabIds)
  tabIdsRef.current = tabIds

  const subscribe = useMemo(
    () => (onChange: () => void) => {
      const sub = store.onDidChange.event(evt => {
        if (tabIdsRef.current.includes(evt.id)) onChange()
      })
      return () => sub.dispose()
    },
    [store],
  )

  const getSnapshot = () => {
    const ids = tabIdsRef.current
    const next: PanelTab[] = new Array(ids.length)
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!
      next[i] = {
        id,
        label: store.title(id, id),
        dirty: store.dirty(id),
        icon: store.icon(id),
        closable: true,
      }
    }
    if (shallowSameTabs(cacheRef.current, next)) return cacheRef.current
    cacheRef.current = next
    return next
  }

  void tabIdsKey
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

const SortableTabTrigger = memo(function SortableTabTrigger({
  tab,
  index,
  panelId,
  onClose,
}: {
  tab: PanelTab
  index: number
  panelId: PanelId
  onClose: (tabId: string) => void
}) {
  const id = tabDndId(panelId, tab.id)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: {
      type: "tab",
      panelId,
      tabId: tab.id,
      label: tab.label,
      dirty: tab.dirty,
    } satisfies TabDragData,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  }

  return (
    <TabsTrigger
      ref={setNodeRef}
      value={tab.id}
      data-tab-index={index}
      data-tab-id={tab.id}
      style={style}
      {...attributes}
      {...listeners}
      className="group max-w-[220px] flex-none cursor-grab touch-none active:cursor-grabbing"
      title={tab.id}
    >
      {tab.icon}
      <span className="truncate">
        {tab.label}
        {tab.dirty ? " •" : ""}
      </span>
      {tab.closable && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          tabIndex={-1}
          aria-label="Close tab"
          className="ml-0.5 opacity-70 group-hover:opacity-100"
          onPointerDown={e => e.stopPropagation()}
          onClick={e => {
            e.stopPropagation()
            onClose(tab.id)
          }}
        >
          <XIcon className="size-3" />
        </Button>
      )}
    </TabsTrigger>
  )
})

export function PanelTabBar({
  panelId,
  view,
  store,
  registry,
  focused,
  onActivateTab,
  onCloseTab,
}: {
  panelId: PanelId
  view: PanelView
  store: TabStore
  registry: TabTypeRegistry
  focused: boolean
  onActivateTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  /** @deprecated handled by TabDndRoot */
  onReorderTab?: (tabId: string, toIndex: number) => void
  /** @deprecated handled by TabDndRoot */
  onTabDrop?: (
    source: PanelId,
    sourceTabId: string,
    target: PanelId,
    action: DropAction,
  ) => void
}) {
  void registry
  void focused
  const drag = usePanelDrag()
  const { tabIds, activeId } = tabIdsOf(view)
  const tabs = useTabsSnapshot(store, tabIds)
  const hasTabs = view.kind === "tabs"
  const sortableIds = useMemo(() => tabs.map(t => tabDndId(panelId, t.id)), [tabs, panelId.id])

  const { setNodeRef: setBarRef, isOver: barOver } = useDroppable({
    id: tabBarDndId(panelId),
    data: { type: "tabbar", panelId },
    disabled: !drag.tabSource,
  })

  if (!hasTabs) return null

  const isForeignDrag =
    drag.tabSource != null && drag.tabSource.panelId.id !== panelId.id

  return (
    <Tabs value={activeId} onValueChange={onActivateTab} className="gap-0">
      <div
        ref={setBarRef}
        data-panel-id={panelId.id}
        data-jet-tab-bar
        className={cn(
          "shrink-0 px-2 py-1.5 transition-colors duration-[var(--jet-motion-fast)]",
          (barOver || isForeignDrag) && isForeignDrag && "bg-muted/30",
        )}
      >
        <SortableContext items={sortableIds} strategy={horizontalListSortingStrategy}>
          <TabsList className="w-full justify-start overflow-x-auto">
            {tabs.map((tab, i) => (
              <SortableTabTrigger
                key={tab.id}
                tab={tab}
                index={i}
                panelId={panelId}
                onClose={onCloseTab}
              />
            ))}
          </TabsList>
        </SortableContext>
      </div>
    </Tabs>
  )
}
