import { LayoutGrid, Plus, X } from "lucide-react"
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
import { deckTileStyle, processIdentity } from "./process-identity.js"
import type { TabOrientation } from "./types.js"

export type MuxTabItem = {
  id: string
  title: string
  /** Foreground process names for panes in this window (deck composition). */
  processNames?: string[]
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

/**
 * Deck icon = favicon for a window (Superlogical).
 * Colored tile(s) from process identity — stacked when the window has multiple panes.
 */
function DeckIcon({
  tabId,
  processNames,
  active,
  className,
}: {
  tabId: string
  processNames?: string[]
  active: boolean
  className?: string
}) {
  const names =
    processNames && processNames.length > 0 ? processNames.slice(0, 3) : [null]
  const primary = processIdentity(names[0])
  return (
    <span
      data-yaade-mux-deck-icon={tabId}
      data-active={active ? "" : undefined}
      aria-hidden
      className={cn(
        "relative flex size-3.5 shrink-0 items-center justify-center",
        !active && "opacity-75",
        className,
      )}
    >
      {names.length > 1 ? (
        <>
          {names.map((name, i) => {
            const id = processIdentity(name)
            return (
              <span
                key={`${tabId}-${i}`}
                style={{
                  ...deckTileStyle(id),
                  transform: `translate(${i * 1.5}px, ${i * -1}px)`,
                  zIndex: names.length - i,
                }}
                className="absolute flex size-2.5 items-center justify-center rounded-[0.2rem] text-[0.4rem] font-semibold leading-none shadow-sm ring-1 ring-black/25"
              >
                {id.glyph}
              </span>
            )
          })}
        </>
      ) : (
        <span
          style={deckTileStyle(primary)}
          className="flex size-3.5 items-center justify-center overflow-hidden rounded-[0.25rem] text-[0.5rem] font-semibold leading-none shadow-sm ring-1 ring-black/25"
        >
          {primary.glyph}
        </span>
      )}
    </span>
  )
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
            vertical ? "w-full" : "h-6 shrink-0",
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
              "yaade-press min-w-0 flex-1 justify-start gap-1 text-2xs after:hidden!",
              vertical
                ? "!h-auto w-full gap-1.5 rounded-full border border-transparent px-2.5 py-1.5 pe-7"
                : "!h-6 max-w-48 min-w-0 gap-1.5 rounded-full border border-transparent pe-6 ps-2",
              "text-muted-foreground hover:text-foreground",
              "data-[state=active]:border-border/70 data-[state=active]:bg-foreground/25",
              "data-[state=active]:text-foreground data-[state=active]:shadow-sm",
              "data-[state=active]:backdrop-blur-md",
              "dark:data-[state=active]:border-white/25 dark:data-[state=active]:bg-white/25",
              !active && "bg-transparent hover:bg-foreground/5",
              enableDrag && "cursor-grab active:cursor-grabbing",
            )}
            onMouseDown={event => {
              if (enableDrag) event.preventDefault()
            }}
            onClick={event => {
              event.preventDefault()
              onSelect(tab.id)
            }}
          >
            <DeckIcon
              tabId={tab.id}
              processNames={tab.processNames}
              active={active}
            />
            <span className="min-w-0 truncate font-medium" data-slot="row-label">
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
              "absolute end-1 top-1/2 size-4 -translate-y-1/2 rounded-full opacity-0",
              "group-hover:opacity-100 group-data-[active]:opacity-100",
              "text-muted-foreground hover:text-foreground",
            )}
            onClick={event => {
              event.preventDefault()
              event.stopPropagation()
              onClose(tab.id)
            }}
            onPointerDown={event => event.stopPropagation()}
          >
            <X className="size-2.5" />
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

  const deckLibraryButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label="Toggle tab orientation"
      data-yaade-mux-deck-library=""
      className="size-6 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
      onClick={onToggleOrientation}
    >
      <LayoutGrid className="size-3" />
    </Button>
  )

  const newButton = (
    <Button
      type="button"
      variant="ghost"
      size={vertical ? "sm" : "icon-xs"}
      aria-label="New window"
      data-yaade-mux-new-tab=""
      className={cn(
        "text-muted-foreground hover:text-foreground",
        vertical &&
          "h-7 w-full justify-start gap-1.5 rounded-full border border-transparent px-2.5 hover:bg-foreground/5",
        !vertical && "size-6 shrink-0 rounded-full",
      )}
      onClick={onNew}
    >
      <Plus className="size-3" />
      {vertical ? <span className="text-2xs">New window</span> : null}
    </Button>
  )

  const tabList = (
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
        data-yaade-mux-icon-deck=""
        className={cn(
          "min-h-0 min-w-0 justify-start bg-transparent p-0",
          vertical
            ? "h-auto w-full flex-1 flex-col items-stretch gap-0.5 overflow-y-auto"
            : "h-6 w-auto flex-none flex-row items-center gap-0.5 overflow-x-auto",
        )}
      >
        {tabs.map((tab, index) => (
          <div key={tab.id} className="flex items-center gap-1">
            {!vertical && index > 0 ? (
              <span
                aria-hidden
                className="mx-px h-2.5 w-px shrink-0 bg-border/50"
              />
            ) : null}
            <MuxTabDragShell
              tab={tab}
              active={tab.id === activeId}
              vertical={vertical}
              enableDrag={enableDragDock}
              onSelect={onSelect}
              onClose={onClose}
              onNew={onNew}
              onToggleOrientation={onToggleOrientation}
            />
          </div>
        ))}
      </TabsList>
    </Tabs>
  )

  return (
    <StripContextMenu onNew={onNew} onToggleOrientation={onToggleOrientation}>
      <div
        data-yaade-mux-tab-strip=""
        data-orientation={orientation}
        className={cn(
          "relative flex shrink-0 border-border/35",
          vertical
            ? cn(
                "h-full w-44 flex-col border-r",
                "bg-background/50 backdrop-blur-xl",
              )
            : cn(
                "h-[var(--yaade-window-chrome-height)] min-h-[var(--yaade-window-chrome-height)] w-full flex-row items-center justify-start gap-0.5 border-b",
                "bg-background/50 px-1.5 backdrop-blur-xl",
              ),
          className,
        )}
      >
        {vertical ? (
          <>
            {tabList}
            <div className="flex shrink-0 items-center border-t border-border/35 p-1.5">
              {newButton}
            </div>
          </>
        ) : (
          <>
            {onToggleOrientation ? deckLibraryButton : null}
            {tabList}
            {newButton}
            <div className="min-w-0 flex-1" aria-hidden />
          </>
        )}
      </div>
    </StripContextMenu>
  )
}

export type { TabOrientation }
