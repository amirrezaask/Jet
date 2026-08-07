import { useDraggable, useDroppable } from "@dnd-kit/core"
import { XIcon } from "lucide-react"
import {
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
  type RefCallback,
} from "react"
import type { PanelId } from "@yaade/shared"
import { Button } from "@/components/ui/button.js"
import { cn } from "@/lib/utils.js"
import type { TabStore } from "../tabs/registry.js"
import { formatSessionHeaderTitle } from "../home/session-header-labels.js"
import { usePanelDrag } from "./PanelDragContext.js"
import {
  tabBarDndId,
  tabDndId,
  type TabDragData,
} from "./tab-dnd-types.js"

export type SessionPaneChromeProps = {
  panelId: PanelId
  tabId: string
  store: TabStore
  focused: boolean
  onClose: (tabId: string) => void
  /** Used to collapse cwd/OSC titles that already end with the project name. */
  projectName?: string | null
  /** Open-in-app, notifications, resume, etc. */
  trailing?: ReactNode
  /** Mode chrome portal target (editor tabs / terminal tabs / git). */
  contextRef?: RefCallback<HTMLElement | null>
}

function useTabTitle(store: TabStore, tabId: string): string {
  const tabIdRef = useRef(tabId)
  tabIdRef.current = tabId
  const subscribe = useMemo(
    () => (onChange: () => void) => {
      const sub = store.onDidChange.event(evt => {
        if (evt.id === tabIdRef.current) onChange()
      })
      return () => sub.dispose()
    },
    [store],
  )
  return useSyncExternalStore(
    subscribe,
    () => store.title(tabIdRef.current, tabIdRef.current),
    () => store.title(tabIdRef.current, tabIdRef.current),
  )
}

/**
 * Single session pane titlebar: drag title, mode chrome portal, trailing
 * actions, close. Replaces both PanelTabBar and the modal header row.
 */
export function SessionPaneChrome({
  panelId,
  tabId,
  store,
  focused,
  onClose,
  projectName = null,
  trailing = null,
  contextRef,
}: SessionPaneChromeProps) {
  const drag = usePanelDrag()
  const storeTitle = useTabTitle(store, tabId)
  const title = formatSessionHeaderTitle(projectName, storeTitle)
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: tabDndId(panelId, tabId),
    data: {
      type: "tab",
      panelId,
      tabId,
      label: title,
    } satisfies TabDragData,
  })

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: tabBarDndId(panelId),
    data: { type: "tabbar", panelId },
    disabled: !drag.tabSource,
  })

  const isForeignDrag =
    drag.tabSource != null &&
    (drag.tabSource.panelId == null ||
      drag.tabSource.panelId.id !== panelId.id)

  return (
    <div
      ref={node => {
        setDragRef(node)
        setDropRef(node)
      }}
      data-yaade-session-pane-chrome=""
      data-yaade-session-window-chrome=""
      data-yaade-terminal-modal-header=""
      data-yaade-tab-bar=""
      data-panel-id={panelId.id}
      data-tab-id={tabId}
      data-focused={focused ? "" : undefined}
      data-dragging={isDragging ? "" : undefined}
      className={cn(
        "flex h-9 shrink-0 items-center gap-1 border-b border-transparent px-2",
        (isOver || isForeignDrag) && isForeignDrag && "bg-muted/30",
        isDragging && "opacity-45",
      )}
    >
      <button
        type="button"
        data-yaade-session-pane-title=""
        data-yaade-terminal-modal-title=""
        className={cn(
          "max-w-[42%] shrink truncate text-left text-xs font-semibold tracking-tight text-foreground",
          "cursor-grab touch-none active:cursor-grabbing",
          "rounded-sm px-1 py-0.5 outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
        title={title}
        {...attributes}
        {...listeners}
      >
        {title}
      </button>

      <div
        ref={contextRef}
        data-yaade-session-header-context=""
        className="flex min-h-0 min-w-0 flex-1 items-center overflow-hidden"
      />

      <div
        className="flex shrink-0 items-center gap-0.5"
        onPointerDown={event => event.stopPropagation()}
      >
        {trailing}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Close tab"
          data-yaade-session-pane-close=""
          onClick={event => {
            event.stopPropagation()
            onClose(tabId)
          }}
        >
          <XIcon className="size-3" />
        </Button>
      </div>
    </div>
  )
}
