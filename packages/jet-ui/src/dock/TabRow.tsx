import { memo, useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { ChevronDown, X } from "lucide-react"
import type { PanelId, TabGroup, TabId } from "@jet/shared"
import type { TabRegistry } from "@jet/workspace"
import { cn } from "../lib/utils.js"

function TabRowInner({
  panelId,
  group,
  registry,
  focused,
  tabMetaRev,
  onSelect,
  onClose,
  onClosePanel,
  onTabPointerDown,
  draggingTabId,
  tabRowRef,
}: {
  panelId: PanelId
  group: TabGroup
  registry: TabRegistry
  focused: boolean
  tabMetaRev: number
  onSelect: (tabId: TabId) => void
  onClose: (tabId: TabId) => void
  onClosePanel?: () => void
  onTabPointerDown: (tabId: TabId, panelId: PanelId, e: ReactPointerEvent) => void
  draggingTabId: number | null
  tabRowRef?: (el: HTMLDivElement | null) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [hasOverflow, setHasOverflow] = useState(false)

  const measureOverflow = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setHasOverflow(el.scrollWidth > el.clientWidth + 1)
  }, [])

  useEffect(() => {
    measureOverflow()
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => measureOverflow())
    ro.observe(el)
    return () => ro.disconnect()
  }, [group.tabs.length, tabMetaRev, measureOverflow])

  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      scrollRef.current = el
      tabRowRef?.(el)
      measureOverflow()
    },
    [tabRowRef, measureOverflow],
  )

  return (
    <div
      className={cn(
        "flex h-7 shrink-0 items-end border-b border-[var(--jet-border)] bg-[var(--jet-panel)]",
        focused && "bg-[var(--jet-panel-raised)]",
      )}
    >
      <div ref={setRefs} className="flex min-w-0 flex-1 items-end gap-px overflow-x-auto px-1">
        {group.tabs.map((tabId, i) => {
          const meta = registry.meta(tabId)
          const active = i === group.active
          const dragging = draggingTabId === tabId.id
          return (
            <div
              key={tabId.id}
              data-tab-id={tabId.id}
              className={cn(
                "group flex max-w-[160px] shrink-0 cursor-pointer items-center gap-1 rounded-t px-2 py-1 text-xs touch-none select-none",
                active
                  ? "bg-[var(--jet-bg)] text-[var(--jet-text)]"
                  : "text-[var(--jet-text-muted)] hover:bg-[var(--jet-hover)]",
                dragging && "opacity-50",
              )}
              onPointerDown={e => onTabPointerDown(tabId, panelId, e)}
              onClick={() => onSelect(tabId)}
            >
              <span className="truncate">
                {meta.dirty ? "● " : ""}
                {meta.label}
              </span>
              {meta.closeable && (
                <button
                  type="button"
                  className="opacity-0 group-hover:opacity-100"
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => {
                    e.stopPropagation()
                    onClose(tabId)
                  }}
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          )
        })}
      </div>
      {hasOverflow && (
        <div className="relative shrink-0 border-l border-[var(--jet-border)]">
          <button
            type="button"
            className="flex h-7 items-center px-1.5 text-[var(--jet-text-muted)] hover:bg-[var(--jet-hover)]"
            onClick={() => setOverflowOpen(v => !v)}
            aria-label="Overflow tabs"
          >
            <ChevronDown className="size-3.5" />
          </button>
          {overflowOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setOverflowOpen(false)} />
              <div className="absolute right-0 top-full z-40 max-h-48 min-w-[140px] overflow-y-auto rounded border border-[var(--jet-border)] bg-[var(--jet-panel-raised)] py-1 shadow-lg">
                {group.tabs.map((tabId, i) => {
                  const meta = registry.meta(tabId)
                  const active = i === group.active
                  return (
                    <button
                      key={tabId.id}
                      type="button"
                      className={cn(
                        "block w-full truncate px-3 py-1 text-left text-xs hover:bg-[var(--jet-hover)]",
                        active && "text-[var(--jet-accent)]",
                      )}
                      onClick={() => {
                        onSelect(tabId)
                        setOverflowOpen(false)
                      }}
                    >
                      {meta.dirty ? "● " : ""}
                      {meta.label}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}
      {onClosePanel && (
        <button
          type="button"
          className="shrink-0 border-l border-[var(--jet-border)] px-1.5 text-[var(--jet-text-muted)] hover:bg-[var(--jet-hover)]"
          onClick={onClosePanel}
          aria-label="Close panel"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

export const TabRow = memo(TabRowInner)

export function computeTabInsertIndex(tabRowEl: HTMLElement, clientX: number): number {
  const tabs = tabRowEl.querySelectorAll<HTMLElement>("[data-tab-id]")
  for (let i = 0; i < tabs.length; i++) {
    const rect = tabs[i]!.getBoundingClientRect()
    const mid = rect.left + rect.width / 2
    if (clientX < mid) return i
  }
  return tabs.length
}
