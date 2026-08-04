import { Plus, SquareTerminal, X } from "lucide-react"
import { useDraggable } from "@dnd-kit/core"
import { Button } from "@/components/ui/button.js"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.js"
import { cn } from "@/lib/utils.js"
import {
  sessionDndId,
  type SessionDragData,
} from "../dock/tab-dnd-types.js"
import type { TabOrientation } from "./types.js"

export type MuxTabItem = {
  id: string
  title: string
}

export type MuxTabStripProps = {
  orientation: TabOrientation
  tabs: MuxTabItem[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
  /** When true, tabs can be dragged onto the tiled dock. */
  enableDragDock?: boolean
  className?: string
}

function MuxTabDragShell({
  tab,
  active,
  vertical,
  enableDrag,
  onSelect,
  onClose,
}: {
  tab: MuxTabItem
  active: boolean
  vertical: boolean
  enableDrag: boolean
  onSelect: (id: string) => void
  onClose: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: sessionDndId(tab.id),
    disabled: !enableDrag,
    data: {
      type: "session",
      tabId: tab.id,
      label: tab.title,
    } satisfies SessionDragData,
  })

  return (
    <div
      ref={setNodeRef}
      data-yaade-mux-tab={tab.id}
      data-active={active ? "" : undefined}
      data-dragging={isDragging ? "" : undefined}
      className={cn(
        "group relative flex min-w-0 items-center",
        vertical ? "w-full" : "max-w-48 shrink-0",
        isDragging && "opacity-45",
        enableDrag && "touch-none",
      )}
      {...(enableDrag ? attributes : {})}
      {...(enableDrag ? listeners : {})}
    >
      <TabsTrigger
        value={tab.id}
        data-yaade-mux-tab-drag=""
        className={cn(
          "yaade-press min-w-0 flex-1 justify-start gap-1.5 px-2 py-1.5 text-xs",
          vertical ? "w-full" : "h-8",
          enableDrag && "cursor-grab active:cursor-grabbing",
        )}
        onMouseDown={event => {
          // Radix Tabs selects on mousedown. Block that without preventDefault on
          // pointerdown — dnd-kit PointerSensor ignores defaultPrevented events.
          if (enableDrag) event.preventDefault()
        }}
        onClick={event => {
          event.preventDefault()
          onSelect(tab.id)
        }}
      >
        <SquareTerminal className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate" data-slot="row-label">
          {tab.title}
        </span>
      </TabsTrigger>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`Close ${tab.title}`}
        data-yaade-mux-close-tab={tab.id}
        className={cn(
          "absolute end-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 group-data-[active]:opacity-100",
          "text-muted-foreground hover:text-foreground",
        )}
        onClick={event => {
          event.preventDefault()
          event.stopPropagation()
          onClose(tab.id)
        }}
        onPointerDown={event => event.stopPropagation()}
      >
        <X className="size-3" />
      </Button>
    </div>
  )
}

export function MuxTabStrip(props: MuxTabStripProps) {
  const {
    orientation,
    tabs,
    activeId,
    onSelect,
    onClose,
    onNew,
    enableDragDock = true,
    className,
  } = props
  const vertical = orientation === "vertical"

  return (
    <div
      data-yaade-mux-tab-strip=""
      data-orientation={orientation}
      className={cn(
        "flex shrink-0 border-border/70 bg-muted/25",
        vertical
          ? "h-full w-52 flex-col border-r"
          : "h-10 w-full flex-row items-center border-b",
        className,
      )}
    >
      <Tabs
        orientation={orientation}
        value={activeId ?? undefined}
        onValueChange={onSelect}
        className={cn(
          "min-h-0 min-w-0 flex-1",
          vertical
            ? "flex flex-col gap-1 p-1.5"
            : "flex flex-row items-center gap-1 px-1.5",
        )}
      >
        <TabsList
          variant="line"
          aria-label="Terminal windows"
          className={cn(
            "min-h-0 min-w-0 flex-1 justify-start bg-transparent p-0",
            vertical
              ? "h-auto w-full flex-col items-stretch overflow-y-auto"
              : "h-8 w-auto flex-row overflow-x-auto",
          )}
        >
          {tabs.map(tab => (
            <MuxTabDragShell
              key={tab.id}
              tab={tab}
              active={tab.id === activeId}
              vertical={vertical}
              enableDrag={enableDragDock}
              onSelect={onSelect}
              onClose={onClose}
            />
          ))}
        </TabsList>
      </Tabs>
      <div
        className={cn(
          "flex shrink-0 items-center p-1.5",
          vertical ? "border-t border-border/50" : "",
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size={vertical ? "sm" : "icon-xs"}
          aria-label="New window"
          data-yaade-mux-new-tab=""
          className={cn(
            "text-muted-foreground hover:text-foreground",
            vertical && "w-full justify-start gap-1.5",
          )}
          onClick={onNew}
        >
          <Plus className="size-3.5" />
          {vertical ? <span className="text-xs">New window</span> : null}
        </Button>
      </div>
    </div>
  )
}

export type { TabOrientation }
