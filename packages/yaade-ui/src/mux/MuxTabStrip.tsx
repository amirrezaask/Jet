import { Plus, X } from "lucide-react"
import { useDraggable } from "@dnd-kit/core"
import type { CSSProperties, ReactNode } from "react"
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

/** Hue wheel for Superlogical-style deck favicons (oklch, theme-agnostic). */
const DECK_HUES = [230, 55, 155, 295, 25, 40, 195, 330] as const

function deckHue(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0
  }
  return DECK_HUES[Math.abs(hash) % DECK_HUES.length]!
}

function deckStyle(id: string): CSSProperties {
  const hue = deckHue(id)
  return {
    backgroundColor: `oklch(0.64 0.15 ${hue})`,
    color: "oklch(0.98 0.01 255)",
  }
}

/**
 * Deck icon = favicon for a window (Superlogical).
 * Colored tile + stacked-card glyph — lives inside each tab, not a separate strip.
 */
function DeckIcon({
  tabId,
  active,
  className,
}: {
  tabId: string
  active: boolean
  className?: string
}) {
  return (
    <span
      data-yaade-mux-deck-icon={tabId}
      data-active={active ? "" : undefined}
      aria-hidden
      style={deckStyle(tabId)}
      className={cn(
        "relative flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-[0.3rem]",
        "shadow-sm ring-1 ring-black/25",
        !active && "opacity-75",
        className,
      )}
    >
      <svg viewBox="0 0 16 16" className="size-2.5 fill-current opacity-95">
        <rect x="3.5" y="5" width="7" height="7" rx="1.1" opacity="0.55" />
        <rect x="5.5" y="3.5" width="7" height="7" rx="1.1" />
      </svg>
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
            vertical ? "w-full" : "h-8 shrink-0",
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
              "yaade-press min-w-0 flex-1 justify-start gap-1.5 text-xs after:hidden!",
              vertical
                ? "w-full px-2 py-1.5"
                : cn(
                    // Capsule pill — !h overrides TabsTrigger's h-[calc(100%-1px)].
                    "!h-8 max-w-56 min-w-0 gap-2 rounded-full border border-transparent pe-7 ps-3",
                    "text-muted-foreground hover:text-foreground",
                    // Active = frosted capsule; inactive = ghost (title-bar text only).
                    "data-[state=active]:border-border/60 data-[state=active]:bg-foreground/20",
                    "data-[state=active]:text-foreground data-[state=active]:shadow-none",
                    "data-[state=active]:backdrop-blur-md",
                    "dark:data-[state=active]:border-white/20 dark:data-[state=active]:bg-white/20",
                    !active && "bg-transparent hover:bg-foreground/5",
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
            <DeckIcon tabId={tab.id} active={active} />
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
              "absolute end-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 group-data-[active]:opacity-100",
              "text-muted-foreground hover:text-foreground",
              !vertical && "end-1.5 size-5 rounded-full",
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
        !vertical && "size-8 shrink-0 rounded-full",
      )}
      onClick={onNew}
    >
      <Plus className="size-3.5" />
      {vertical ? <span className="text-xs">New window</span> : null}
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
            ? "h-auto w-full flex-1 flex-col items-stretch overflow-y-auto"
            : "h-8 w-auto flex-none flex-row items-center gap-1 overflow-x-auto",
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
  )

  return (
    <StripContextMenu onNew={onNew} onToggleOrientation={onToggleOrientation}>
      <div
        data-yaade-mux-tab-strip=""
        data-orientation={orientation}
        className={cn(
          "relative flex shrink-0 border-border/35",
          vertical
            ? "h-full w-52 flex-col border-r bg-muted/20"
            : cn(
                "h-11 w-full flex-row items-center justify-center gap-1 border-b",
                "bg-background/50 px-3 backdrop-blur-xl",
              ),
          className,
        )}
      >
        {vertical ? (
          <>
            {tabList}
            <div className="flex shrink-0 items-center border-t border-border/50 p-1.5">
              {newButton}
            </div>
          </>
        ) : (
          <>
            {tabList}
            {newButton}
          </>
        )}
      </div>
    </StripContextMenu>
  )
}

export type { TabOrientation }
