import { LayoutGrid, Plus, SquareTerminal, X } from "lucide-react"
import { useDraggable } from "@dnd-kit/core"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button.js"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu.js"
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
  onToggleOrientation?: () => void
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
  onNew,
  onToggleOrientation,
}: {
  tab: MuxTabItem
  active: boolean
  vertical: boolean
  enableDrag: boolean
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
  onToggleOrientation?: () => void
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
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          data-yaade-mux-tab={tab.id}
          data-active={active ? "" : undefined}
          data-dragging={isDragging ? "" : undefined}
          className={cn(
            "group relative flex min-w-0 items-center",
            vertical ? "w-full" : "shrink-0",
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
              "yaade-press min-w-0 flex-1 justify-start gap-1.5 text-xs",
              vertical
                ? "w-full px-2 py-1.5"
                : cn(
                    "h-7 max-w-44 rounded-md border border-transparent px-2",
                    "data-[state=active]:border-border/70 data-[state=active]:bg-card/80",
                    "data-[state=active]:shadow-sm data-[state=active]:backdrop-blur-sm",
                    "dark:data-[state=active]:bg-card/55",
                  ),
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
            <SquareTerminal
              className={cn(
                "size-3.5 shrink-0",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            />
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
      </ContextMenuTrigger>
      <ContextMenuContent data-yaade-mux-tab-context-menu="">
        <ContextMenuItem onSelect={() => onSelect(tab.id)}>
          Focus Window
        </ContextMenuItem>
        <ContextMenuItem onSelect={onNew}>New Window</ContextMenuItem>
        {onToggleOrientation ? (
          <ContextMenuItem onSelect={onToggleOrientation}>
            Toggle Tab Orientation
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onSelect={() => onClose(tab.id)}
        >
          Close Window
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function StripContextMenu({
  onNew,
  onToggleOrientation,
  children,
}: {
  onNew: () => void
  onToggleOrientation?: () => void
  children: ReactNode
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent data-yaade-mux-tab-strip-context-menu="">
        <ContextMenuItem onSelect={onNew}>New Window</ContextMenuItem>
        {onToggleOrientation ? (
          <ContextMenuItem onSelect={onToggleOrientation}>
            Toggle Tab Orientation
          </ContextMenuItem>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
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
    onToggleOrientation,
    enableDragDock = true,
    className,
  } = props
  const vertical = orientation === "vertical"

  const newButton = (
    <Button
      type="button"
      variant="ghost"
      size={vertical ? "sm" : "icon-xs"}
      aria-label="New window"
      data-yaade-mux-new-tab=""
      className={cn(
        "text-muted-foreground hover:text-foreground",
        vertical && "w-full justify-start gap-1.5",
        !vertical && "size-7 shrink-0 rounded-md",
      )}
      onClick={onNew}
    >
      <Plus className="size-3.5" />
      {vertical ? <span className="text-xs">New window</span> : null}
    </Button>
  )

  return (
    <StripContextMenu onNew={onNew} onToggleOrientation={onToggleOrientation}>
      <div
        data-yaade-mux-tab-strip=""
        data-orientation={orientation}
        className={cn(
          "flex shrink-0 border-border/50",
          vertical
            ? "h-full w-52 flex-col border-r bg-muted/20"
            : "h-10 w-full flex-row items-center justify-start gap-1 border-b bg-transparent px-2",
          className,
        )}
      >
        {!vertical ? (
          <div
            data-yaade-mux-icon-deck=""
            className="flex shrink-0 items-center gap-0.5 rounded-md bg-muted/35 p-0.5 ring-1 ring-border/40"
            aria-hidden
          >
            <LayoutGrid className="size-3.5 text-muted-foreground" />
            {tabs.slice(0, 4).map(tab => (
              <button
                key={`deck-${tab.id}`}
                type="button"
                tabIndex={-1}
                title={tab.title}
                data-yaade-mux-deck-icon={tab.id}
                data-active={tab.id === activeId ? "" : undefined}
                className={cn(
                  "flex size-5 items-center justify-center rounded-sm",
                  "text-muted-foreground transition-colors",
                  "hover:bg-background/60 hover:text-foreground",
                  "active:scale-[0.97]",
                  tab.id === activeId && "bg-background/70 text-foreground shadow-sm",
                )}
                onClick={() => onSelect(tab.id)}
              >
                <SquareTerminal className="size-3" />
              </button>
            ))}
          </div>
        ) : null}

        <Tabs
          orientation={orientation}
          value={activeId ?? undefined}
          onValueChange={onSelect}
          className={cn(
            "min-h-0 min-w-0",
            vertical
              ? "flex flex-1 flex-col gap-1 p-1.5"
              : "flex flex-none flex-row items-center",
          )}
        >
          <TabsList
            variant="line"
            aria-label="Terminal windows"
            className={cn(
              "min-h-0 min-w-0 justify-start bg-transparent p-0",
              vertical
                ? "h-auto w-full flex-1 flex-col items-stretch overflow-y-auto"
                : "h-7 w-auto flex-none flex-row items-center gap-0.5 overflow-x-auto",
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
                onNew={onNew}
                onToggleOrientation={onToggleOrientation}
              />
            ))}
          </TabsList>
        </Tabs>

        {vertical ? (
          <div className="flex shrink-0 items-center border-t border-border/50 p-1.5">
            {newButton}
          </div>
        ) : (
          <div className="flex shrink-0 items-center ps-0.5">{newButton}</div>
        )}
      </div>
    </StripContextMenu>
  )
}

export type { TabOrientation }
