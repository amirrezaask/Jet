import { useState, type DragEvent, type ReactNode } from "react"
import { XIcon } from "lucide-react"
import { basename } from "@jet/shared"
import type { DropAction, PanelId, PanelView } from "@jet/shared"
import type { WorkspaceService } from "@jet/workspace"
import { editorBuffers } from "@jet/workspace"
import { TAB_DRAG_MIME, usePanelDrag } from "./PanelDragContext.js"
import { cn } from "@/lib/utils.js"

export type PanelTab = {
  id: string
  label: string
  dirty?: boolean
  closable: boolean
}

function editorTabs(view: PanelView, workspace: WorkspaceService): PanelTab[] {
  if (view.kind !== "editor") return []
  return editorBuffers(view).map(uri => {
    const file = workspace.fileForUri(uri)
    return {
      id: uri,
      label: file?.name ?? basename(uri) ?? uri,
      dirty: !!file?.isDirty,
      closable: true,
    }
  })
}

function nonEditorTab(view: PanelView): PanelTab | null {
  switch (view.kind) {
    case "empty":
      return { id: "empty", label: "Empty", closable: true }
    case "explorer":
      return { id: "explorer", label: "Explorer", closable: false }
    case "locationlist":
      return { id: "locationlist", label: "Locations", closable: true }
    case "output":
      return { id: "output", label: "Output", closable: true }
    default:
      return null
  }
}

export function panelTabsFor(view: PanelView, workspace: WorkspaceService): {
  tabs: PanelTab[]
  activeId: string
} {
  if (view.kind === "editor") {
    const tabs = editorTabs(view, workspace)
    return { tabs, activeId: view.fileUri }
  }
  const tab = nonEditorTab(view)
  return { tabs: tab ? [tab] : [], activeId: tab?.id ?? "" }
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
  // Past last tab — insert at end.
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
  onClosePanel,
  onReorderTab,
  onTabDrop,
}: {
  panelId: PanelId
  view: PanelView
  workspace: WorkspaceService
  focused: boolean
  onActivateTab: (uri: string) => void
  onCloseTab: (uri: string) => void
  onClosePanel: () => void
  onReorderTab: (uri: string, toIndex: number) => void
  onTabDrop: (
    source: PanelId,
    sourceUri: string,
    target: PanelId,
    action: DropAction,
  ) => void
}) {
  const drag = usePanelDrag()
  const { tabs, activeId } = panelTabsFor(view, workspace)
  const [dropTarget, setDropTarget] = useState<TabDropTarget>(null)
  const isEditor = view.kind === "editor"

  const onTabDragStart = (e: DragEvent<HTMLDivElement>, uri: string) => {
    e.stopPropagation()
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData(TAB_DRAG_MIME, `${panelId.id}|${uri}`)
    const el = e.currentTarget as HTMLElement
    e.dataTransfer.setDragImage(el, 10, 10)
    drag.startTab({ panelId, uri })
  }

  const onTabDragEnd = () => {
    drag.endTab()
    setDropTarget(null)
  }

  const onListDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!isEditor) return
    const src = drag.tabSource
    if (!src) return
    e.preventDefault()
    e.stopPropagation()
    setDropTarget(computeTabDropTarget(e, tabs))
  }

  const onListDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!isEditor) return
    const src = drag.tabSource
    if (!src) return
    e.preventDefault()
    e.stopPropagation()

    const target = dropTarget ?? computeTabDropTarget(e, tabs)
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

  const items: ReactNode[] = []
  tabs.forEach((tab, i) => {
    const isActive = tab.id === activeId
    const showLeft =
      dropTarget?.tabIndex === i && dropTarget.side === "left"
    const showRight =
      dropTarget?.tabIndex === i && dropTarget.side === "right"
    items.push(
      <div
        key={tab.id}
        data-tab-index={i}
        data-tab-id={tab.id}
        draggable
        onDragStart={e => onTabDragStart(e, tab.id)}
        onDragEnd={onTabDragEnd}
        onClick={() => onActivateTab(tab.id)}
        className={cn(
          "group flex h-full min-w-0 cursor-grab select-none items-center gap-1.5 border-r border-border/60 px-2 text-xs active:cursor-grabbing",
          showLeft && "border-l-2 border-l-primary",
          showRight && "border-r-2 border-r-primary",
          isActive
            ? focused
              ? "bg-background text-foreground"
              : "bg-background/60 text-foreground"
            : "text-muted-foreground hover:bg-muted/70",
        )}
        title={tab.id}
      >
        <span className="truncate">
          {tab.label}
          {tab.dirty ? " •" : ""}
        </span>
        {tab.closable && (
          <button
            type="button"
            aria-label="Close tab"
            className="ml-0.5 rounded-sm p-0.5 text-muted-foreground/70 hover:bg-muted hover:text-foreground opacity-70 group-hover:opacity-100"
            onMouseDown={e => e.stopPropagation()}
            onClick={e => {
              e.stopPropagation()
              if (isEditor) onCloseTab(tab.id)
              else onClosePanel()
            }}
          >
            <XIcon className="size-3" />
          </button>
        )}
      </div>,
    )
  })

  return (
    <div
      className={cn(
        "flex h-8 shrink-0 items-stretch border-b border-border bg-muted/40",
        focused ? "border-b-primary/50" : "",
      )}
      data-panel-id={panelId.id}
      data-jet-tab-bar
      onDragOver={onListDragOver}
      onDrop={onListDrop}
      onDragLeave={() => setDropTarget(null)}
    >
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {items}
      </div>
    </div>
  )
}
