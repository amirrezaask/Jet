import { memo, useEffect, useRef, useState } from "react"
import type { PanelId } from "@gharargah/shared"
import { cn } from "@/lib/utils.js"
import type { TabStore, TabTypeRegistry } from "./registry.js"

function useTabRevision(store: TabStore, tabId: string): number {
  const [rev, setRev] = useState(0)
  useEffect(() => {
    const sub = store.onDidChange.event(evt => {
      if (evt.id === tabId) setRev(r => r + 1)
    })
    return () => sub.dispose()
  }, [store, tabId])
  return rev
}

function TabSlotInner({
  tabId,
  panelId,
  focused,
  isActive,
  store,
  registry,
}: {
  tabId: string
  panelId: PanelId
  focused: boolean
  isActive: boolean
  store: TabStore
  registry: TabTypeRegistry
}) {
  useTabRevision(store, tabId)
  const instance = store.get(tabId)
  if (!instance) return null
  const type = registry.get(instance.typeId)
  if (!type) return null
  return <>{type.render(instance, { panelId, focused, isActive })}</>
}

const TabSlot = memo(TabSlotInner)

/**
 * Renders the tabs mounted in a panel. Active tab is visible; inactive tabs stay
 * mounted (display:none) unless the TabType opts out via keepMounted:false.
 */
function TabHostInner({
  tabIds,
  activeTabId,
  panelId,
  focused,
  store,
  registry,
}: {
  tabIds: string[]
  activeTabId: string
  panelId: PanelId
  focused: boolean
  store: TabStore
  registry: TabTypeRegistry
}) {
  const mountedTabsRef = useRef<string[]>([])
  const mountedTabs = mountedTabsRef.current.filter(tabId => tabIds.includes(tabId))
  const activeIndex = mountedTabs.indexOf(activeTabId)
  if (activeIndex >= 0) mountedTabs.splice(activeIndex, 1)
  mountedTabs.push(activeTabId)
  while (mountedTabs.length > 3) mountedTabs.shift()
  mountedTabsRef.current = mountedTabs

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col">
      {tabIds.map(tabId => {
        const isActive = tabId === activeTabId
        const type = store.typeOf(tabId)
        const keepMounted = type?.keepMounted !== false
        if (!isActive && (!keepMounted || !mountedTabs.includes(tabId))) return null
        return (
          <div
            key={tabId}
            className={cn("absolute inset-0 min-h-0 min-w-0 flex-col", isActive ? "flex" : "hidden")}
            data-gharargah-tab-slot={tabId}
            data-gharargah-tab-active={isActive ? "" : undefined}
          >
            <TabSlot
              tabId={tabId}
              panelId={panelId}
              focused={focused && isActive}
              isActive={isActive}
              store={store}
              registry={registry}
            />
          </div>
        )
      })}
    </div>
  )
}

export const TabHost = memo(TabHostInner)
