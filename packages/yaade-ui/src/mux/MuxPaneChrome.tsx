import { Columns2, Maximize2, Minimize2, Rows2, X } from "lucide-react"
import { useDraggable } from "@dnd-kit/core"
import type { ReactNode } from "react"
import type { PanelId } from "@yaade/shared"
import { Button } from "@/components/ui/button.js"
import { cn } from "@/lib/utils.js"
import { tabDndId, type TabDragData } from "../dock/tab-dnd-types.js"

export type MuxPaneChromeProps = {
  title: string
  focused: boolean
  paneId: string
  panelId: PanelId
  zoomed: boolean
  canZoom: boolean
  /** When false, title is not a drag handle (e.g. zoomed solo). */
  draggable?: boolean
  onSplitRight: () => void
  onSplitDown: () => void
  onZoom: () => void
  onClose: () => void
  className?: string
  trailing?: ReactNode
}

export function MuxPaneChrome(props: MuxPaneChromeProps) {
  const {
    title,
    focused,
    paneId,
    panelId,
    zoomed,
    canZoom,
    draggable = true,
    onSplitRight,
    onSplitDown,
    onZoom,
    onClose,
    className,
    trailing,
  } = props

  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useDraggable({
    id: tabDndId(panelId, paneId),
    disabled: !draggable || zoomed,
    data: {
      type: "tab",
      panelId,
      tabId: paneId,
      label: title,
    } satisfies TabDragData,
  })

  return (
    <div
      ref={setNodeRef}
      data-yaade-mux-pane-chrome={paneId}
      data-panel-id={panelId.id}
      data-focused={focused ? "" : undefined}
      data-zoomed={zoomed ? "" : undefined}
      data-dragging={isDragging ? "" : undefined}
      className={cn(
        "flex h-8 shrink-0 items-center gap-1 border-b border-border/60 px-1.5",
        focused ? "bg-card/80" : "bg-muted/20",
        isDragging && "opacity-45",
        className,
      )}
    >
      <button
        type="button"
        data-yaade-mux-pane-title=""
        data-yaade-mux-pane-drag=""
        className={cn(
          "min-w-0 flex-1 truncate px-1 text-left text-xs font-medium text-foreground/90",
          "rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-ring",
          draggable && !zoomed
            ? "cursor-grab touch-none active:cursor-grabbing"
            : "",
        )}
        title={title}
        {...(draggable && !zoomed ? { ...attributes, ...listeners } : {})}
      >
        {title}
      </button>
      {trailing}
      <div
        className="flex shrink-0 items-center gap-0.5"
        onPointerDown={event => event.stopPropagation()}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Split right"
          data-yaade-mux-split="right"
          className="text-muted-foreground hover:text-foreground"
          onClick={onSplitRight}
        >
          <Columns2 className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Split down"
          data-yaade-mux-split="down"
          className="text-muted-foreground hover:text-foreground"
          onClick={onSplitDown}
        >
          <Rows2 className="size-3.5" />
        </Button>
        {canZoom ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={zoomed ? "Restore pane" : "Zoom pane"}
            data-yaade-mux-zoom=""
            className="text-muted-foreground hover:text-foreground"
            onClick={onZoom}
          >
            {zoomed ? (
              <Minimize2 className="size-3.5" />
            ) : (
              <Maximize2 className="size-3.5" />
            )}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Close pane"
          data-yaade-mux-close-pane=""
          className="text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
