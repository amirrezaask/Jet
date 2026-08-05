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
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu.js"
import { formatKeyBinding } from "@/lib/format-key.js"
import { cn } from "@/lib/utils.js"
import { tabDndId, type TabDragData } from "../dock/tab-dnd-types.js"
import { deckTileStyle, processIdentity } from "./process-identity.js"

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
  title: string
  focused: boolean
  paneId: string
  panelId: PanelId
  zoomed: boolean
  canZoom: boolean
  /** Foreground process basename for the deck tile. */
  processName?: string | null
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
    processName,
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

  const identity = processIdentity(processName)
  const tileStyle = deckTileStyle(identity)

  const secondaryControls = (
    <>
      {trailing}
      {onOpenGit ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Open Git (${formatKeyBinding("Mod-g")})`}
          title={`Open Git (${formatKeyBinding("Mod-g")})`}
          data-yaade-mux-open-git=""
          className="text-muted-foreground hover:text-foreground opacity-0 group-hover/mux-pane:opacity-100 group-focus-within/mux-pane:opacity-100"
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
          aria-label={`Open Neovim (${formatKeyBinding("Mod-n")})`}
          title={`Open Neovim (${formatKeyBinding("Mod-n")})`}
          data-yaade-mux-open-nvim=""
          className="text-muted-foreground hover:text-foreground opacity-0 group-hover/mux-pane:opacity-100 group-focus-within/mux-pane:opacity-100"
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
          className="text-muted-foreground hover:text-foreground opacity-0 group-hover/mux-pane:opacity-100 group-focus-within/mux-pane:opacity-100"
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
        className="text-muted-foreground hover:text-foreground opacity-0 group-hover/mux-pane:opacity-100 group-focus-within/mux-pane:opacity-100"
        onClick={onClose}
      >
        <X className="size-3.5" />
      </Button>
    </>
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
            "group/mux-chrome flex h-7 shrink-0 items-center gap-1.5 border-b px-2",
            "border-border/35 bg-background/40 backdrop-blur-md",
            focused && "border-border/55 bg-background/55",
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
              "flex min-w-0 flex-1 items-center gap-1.5 outline-none",
              draggable && !zoomed
                ? "cursor-grab touch-none active:cursor-grabbing"
                : "",
            )}
            {...(draggable && !zoomed ? { ...attributes, ...listeners } : {})}
          >
            <span
              aria-hidden
              data-yaade-mux-pane-process={processName ?? ""}
              style={tileStyle}
              className="flex size-3.5 shrink-0 items-center justify-center rounded-[0.25rem] text-[0.55rem] font-semibold leading-none shadow-sm ring-1 ring-black/25"
            >
              {identity.glyph}
            </span>
            <span
              className={cn(
                "min-w-0 truncate text-xs font-medium",
                focused ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {title}
            </span>
          </button>
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
            {secondaryControls}
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent data-yaade-mux-pane-context-menu="">
        <ContextMenuItem onSelect={onSplitRight}>Split Right</ContextMenuItem>
        <ContextMenuItem onSelect={onSplitDown}>Split Down</ContextMenuItem>
        {onOpenGit ? (
          <ContextMenuItem onSelect={onOpenGit}>
            Open Git
            <ContextMenuShortcut>{formatKeyBinding("Mod-g")}</ContextMenuShortcut>
          </ContextMenuItem>
        ) : null}
        {onOpenNeovim ? (
          <ContextMenuItem onSelect={onOpenNeovim}>
            Open Neovim
            <ContextMenuShortcut>{formatKeyBinding("Mod-n")}</ContextMenuShortcut>
          </ContextMenuItem>
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
