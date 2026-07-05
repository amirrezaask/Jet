import { useState, type DragEvent, type ReactNode } from "react"
import { XIcon } from "lucide-react"
import { basename } from "@jet/shared"
import type { DropAction, PanelId, PanelView } from "@jet/shared"
import type { WorkspaceService } from "@jet/workspace"
import { panelTabIds } from "@jet/workspace"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.js"
import { TAB_DRAG_MIME, usePanelDrag, resolveTabDragSource } from "./PanelDragContext.js"
import { cn } from "@/lib/utils.js"

export type PanelTab = {
  id: string
  label: string
  dirty?: boolean
  closable: boolean
}

export function panelTabsFor(view: PanelView, workspace: WorkspaceService): {
  tabs: PanelTab[]
  activeId: string
} {
  if (view.kind !== "tabs") {
    return { tabs: [], activeId: "" }
  }
  const tabs = panelTabIds(view).map(id => {
    const desc = workspace.tabRegistry.get(id)
    const file = desc?.kind === "editor" ? workspace.fileForUri(id) : undefined
    return {
      id,
      label: desc?.label ?? file?.name ?? basename(id) ?? id,
      dirty: !!file?.isDirty,
      closable: true,
    }
  })
  return { tabs, activeId: view.activeTabId }
}

function getTabDragOverLocation(e: DragEvent, tabEl: HTMLElement): "left" | "right" {
  const rect = tabEl.getBoundingClientRect()
  return e.clientX - rect.left <= rect.width / 2 ? "left" : "right"
}

function computeInsertIndex(
  e: DragEvent<HTMLDivElement>,
  tabs: PanelTab[],
): number {
  const bar = e.currentTarget
  const rect = bar.getBoundingClientRect()
  const relX = e.clientX - rect.left
  const children = Array.from(bar.querySelectorAll("[data-tab-index]"))
  for (const child of children) {
    const cr = (child as HTMLElement).getBoundingClientRect()
    const cx = cr.left - rect.left + cr.width / 2
    if (relX < cx) {
      return Number((child as HTMLElement).dataset.tabIndex)
    }
  }
  return tabs.length
}

type TabDropTarget = { tabIndex: number; side: "left" | "right" } | null

function computeTabDropTarget(
  e: DragEvent<HTMLDivElement>,
  tabs: PanelTab[],
): TabDropTarget {
  const bar = e.currentTarget
  const children = Array.from(bar.querySelectorAll("[data-tab-index]"))
  for (const child of children) {
    const el = child as HTMLElement
    const idx = Number(el.dataset.tabIndex)
    const rect = el.getBoundingClientRect()
    if (
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom
    ) {
      return { tabIndex: idx, side: getTabDragOverLocation(e, el) }
    }
  }
  if (tabs.length > 0) {
    const last = children[children.length - 1] as HTMLElement | undefined
    if (last) {
      const rect = last.getBoundingClientRect()
      if (e.clientX > rect.right) {
        return { tabIndex: tabs.length - 1, side: "right" }
      }
    }
  }
  return null
}

export function PanelTabBar({
  panelId,
  view,
  workspace,
  focused,
  onActivateTab,
  onCloseTab,
  onReorderTab,
  onTabDrop,
}: {
  panelId: PanelId
  view: PanelView
  workspace: WorkspaceService
  focused: boolean
  onActivateTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onReorderTab: (tabId: string, toIndex: number) => void
  onTabDrop: (
    source: PanelId,
    sourceTabId: string,
    target: PanelId,
    action: DropAction,
  ) => void
}) {
  const drag = usePanelDrag()
  const { tabs, activeId } = panelTabsFor(view, workspace)
  const [dropTarget, setDropTarget] = useState<TabDropTarget>(null)
  const hasTabs = view.kind === "tabs"

  const onTabDragStart = (e: DragEvent<HTMLButtonElement>, tabId: string) => {
    e.stopPropagation()
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData(TAB_DRAG_MIME, `${panelId.id}|${tabId}`)
    const el = e.currentTarget as HTMLElement
    e.dataTransfer.setDragImage(el, 10, 10)
    drag.startTab({ panelId, uri: tabId })
  }

  const onTabDragEnd = () => {
    drag.endTab()
    setDropTarget(null)
  }

  const onListDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!hasTabs) return
    if (!drag.tabSource && !e.dataTransfer.types.includes(TAB_DRAG_MIME)) return
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(computeTabDropTarget(e, tabs))
  }

  const onListDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!hasTabs) return
    const src = resolveTabDragSource(e, drag.tabSource)
    if (!src) return
    e.preventDefault()
    e.stopPropagation()

    const target = computeTabDropTarget(e, tabs)
    let insertIndex = computeInsertIndex(e, tabs)
    if (target) {
      insertIndex = target.side === "right" ? target.tabIndex + 1 : target.tabIndex
    }

    setDropTarget(null)
    drag.endTab()

    if (src.panelId.id === panelId.id) {
      onReorderTab(src.uri, insertIndex)
    } else {
      onTabDrop(src.panelId, src.uri, panelId, { kind: "moveToPane", insertIndex })
    }
  }

  if (!hasTabs) return null

  const triggers: ReactNode[] = tabs.map((tab, i) => {
    const showLeft = dropTarget?.tabIndex === i && dropTarget.side === "left"
    const showRight = dropTarget?.tabIndex === i && dropTarget.side === "right"
    return (
      <TabsTrigger
        key={tab.id}
        value={tab.id}
        data-tab-index={i}
        data-tab-id={tab.id}
        draggable
        onDragStart={e => onTabDragStart(e, tab.id)}
        onDragEnd={onTabDragEnd}
        className={cn(
          "group h-8 max-w-none flex-none cursor-grab gap-1 rounded-none px-2 text-xs active:cursor-grabbing",
          showLeft && "border-l-2 border-l-primary",
          showRight && "border-r-2 border-r-primary",
          !focused && "data-[state=active]:bg-background/60",
        )}
        title={tab.id}
      >
        <span className="truncate">
          {tab.label}
          {tab.dirty ? " •" : ""}
        </span>
        {tab.closable && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Close tab"
            className="ml-0.5 rounded-sm p-0.5 text-muted-foreground/70 opacity-70 hover:bg-muted hover:text-foreground group-hover:opacity-100"
            onPointerDown={e => e.stopPropagation()}
            onClick={e => {
              e.stopPropagation()
              onCloseTab(tab.id)
            }}
          >
            <XIcon className="size-3" />
          </span>
        )}
      </TabsTrigger>
    )
  })

  return (
    <Tabs
      value={activeId}
      onValueChange={onActivateTab}
      className="gap-0"
    >
      <div
        data-panel-id={panelId.id}
        data-jet-tab-bar
        className={cn(
          "shrink-0 border-b border-border",
          focused ? "border-b-primary/50" : "",
        )}
        onDragOver={onListDragOver}
        onDrop={onListDrop}
        onDragLeave={() => setDropTarget(null)}
      >
        <TabsList className="h-8 w-full justify-start overflow-x-auto rounded-none bg-muted/40 p-0">
          {triggers}
        </TabsList>
      </div>
    </Tabs>
  )
}
