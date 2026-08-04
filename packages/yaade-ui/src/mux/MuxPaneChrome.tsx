import { Columns2, GitBranch, Maximize2, Minimize2, Rows2, X } from "lucide-react"
import { useDraggable } from "@dnd-kit/core"
import type { ReactNode, SVGProps } from "react"
import type { PanelId } from "@yaade/shared"
import { Button } from "@/components/ui/button.js"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu.js"
import { cn } from "@/lib/utils.js"
import { tabDndId, type TabDragData } from "../dock/tab-dnd-types.js"

/** Simple Icons Neovim mark — monochrome via currentColor. */
function NeovimIcon(props: SVGProps<SVGSVGElement>) {
  const { className, ...rest } = props
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-hidden
      className={cn("size-3.5 shrink-0 fill-current", className)}
      {...rest}
    >
      <path d="M2.214 4.954v13.615L7.655 24V10.314L3.312 3.845 2.214 4.954zm4.999 17.98l-4.557-4.548V5.136l.59-.596 3.967 5.908v12.485zm14.573-4.457l-.862.937-4.24-6.376V0l5.068 5.092.034 13.385zM7.431.001l12.998 19.835-3.637 3.637L3.787 3.683 7.43 0z" />
    </svg>
  )
}

export type MuxPaneChromeProps = {
  /** Used for drag label / a11y; not shown in the chrome. */
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
  /** Open Git workspace in a new split beside this pane. */
  onOpenGit?: () => void
  /** Open Neovim (PTY) in a new split beside this pane. */
  onOpenNeovim?: () => void
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
    onOpenGit,
    onOpenNeovim,
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

  const controls = (
    <div
      className={cn(
        "pointer-events-auto flex shrink-0 items-center gap-0.5 rounded-md",
        "bg-background/55 px-0.5 py-0.5 shadow-sm backdrop-blur-md",
        "ring-1 ring-border/40",
        "opacity-0 transition-opacity duration-[var(--yaade-motion-fast)] ease-[var(--yaade-ease-out)]",
        "group-hover/mux-pane:opacity-100 group-focus-within/mux-pane:opacity-100",
        focused && "opacity-100",
      )}
      onPointerDown={event => event.stopPropagation()}
    >
      {trailing}
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
      {onOpenGit ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Open Git"
          data-yaade-mux-open-git=""
          className="text-muted-foreground hover:text-foreground"
          onClick={onOpenGit}
        >
          <GitBranch className="size-3.5" />
        </Button>
      ) : null}
      {onOpenNeovim ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Open Neovim"
          data-yaade-mux-open-nvim=""
          className="text-muted-foreground hover:text-foreground"
          onClick={onOpenNeovim}
        >
          <NeovimIcon />
        </Button>
      ) : null}
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
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          data-yaade-mux-pane-chrome={paneId}
          data-panel-id={panelId.id}
          data-focused={focused ? "" : undefined}
          data-zoomed={zoomed ? "" : undefined}
          data-dragging={isDragging ? "" : undefined}
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 z-20 flex h-8 items-stretch",
            "bg-gradient-to-b from-background/35 via-background/10 to-transparent",
            isDragging && "opacity-45",
            className,
          )}
        >
          <button
            type="button"
            aria-label={title}
            title={title}
            data-yaade-mux-pane-title=""
            data-yaade-mux-pane-drag=""
            className={cn(
              "pointer-events-auto min-w-0 flex-1 outline-none",
              draggable && !zoomed
                ? "cursor-grab touch-none active:cursor-grabbing"
                : "",
            )}
            {...(draggable && !zoomed ? { ...attributes, ...listeners } : {})}
          />
          <div className="pointer-events-none flex items-center pe-1.5 ps-1">
            {controls}
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent data-yaade-mux-pane-context-menu="">
        <ContextMenuItem onSelect={onSplitRight}>Split Right</ContextMenuItem>
        <ContextMenuItem onSelect={onSplitDown}>Split Down</ContextMenuItem>
        {onOpenGit ? (
          <ContextMenuItem onSelect={onOpenGit}>Open Git</ContextMenuItem>
        ) : null}
        {onOpenNeovim ? (
          <ContextMenuItem onSelect={onOpenNeovim}>Open Neovim</ContextMenuItem>
        ) : null}
        {canZoom ? (
          <ContextMenuItem onSelect={onZoom}>
            {zoomed ? "Restore Pane" : "Zoom Pane"}
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={onClose}>
          Close Pane
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
