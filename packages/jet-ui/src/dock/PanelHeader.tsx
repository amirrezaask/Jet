import { MoreHorizontalIcon, XIcon } from "lucide-react"
import { basename } from "@jet/shared"
import type { PanelId, PanelView } from "@jet/shared"
import type { WorkspaceService } from "@jet/workspace"
import { Button } from "@/components/ui/button.js"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.js"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js"

export function panelTitle(view: PanelView | null, workspace: WorkspaceService): string {
  if (!view || view.kind === "empty") return "Empty"
  switch (view.kind) {
    case "editor": {
      const file = workspace.fileForUri(view.fileUri)
      return file?.name ?? basename(view.fileUri) ?? "Editor"
    }
    case "explorer":
      return "Explorer"
    case "locationlist":
      return "Locations"
    case "output":
      return "Output"
    default:
      return "Panel"
  }
}

export function PanelHeader({
  panelId,
  view,
  workspace,
  focused,
  onClosePanel,
  onSplitEditor,
}: {
  panelId: PanelId
  view: PanelView | null
  workspace: WorkspaceService
  focused: boolean
  onClosePanel: (panelId: PanelId) => void
  onSplitEditor?: () => void
}) {
  const title = panelTitle(view, workspace)
  const dirty =
    view?.kind === "editor" ? workspace.fileForUri(view.fileUri)?.isDirty : false
  const isEditor = view?.kind === "editor"
  const isExplorer = view?.kind === "explorer"
  const showOverflow = isEditor || (view != null && view.kind !== "empty" && !isExplorer)
  const showClose = !isExplorer

  return (
    <div
      className="flex h-7 shrink-0 items-center gap-2 border-b border-border bg-muted/50 px-2"
      data-panel-id={panelId.id}
    >
      {isEditor ? (
        <span className="min-w-0 flex-1" />
      ) : (
        <span
          className={`min-w-0 flex-1 truncate text-xs uppercase tracking-wide ${focused ? "text-foreground" : "text-muted-foreground"}`}
        >
          {title}
          {dirty ? " •" : ""}
        </span>
      )}
      <div className="flex shrink-0 items-center gap-0.5">
        {showOverflow && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground hover:text-foreground"
                aria-label="Panel actions"
                onClick={e => e.stopPropagation()}
              >
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={e => e.stopPropagation()}>
              {isEditor && onSplitEditor && (
                <>
                  <DropdownMenuItem
                    onClick={() => {
                      onSplitEditor()
                    }}
                  >
                    Split Right
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onClosePanel(panelId)}
              >
                Close Panel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {showClose && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close panel"
              onClick={e => {
                e.stopPropagation()
                onClosePanel(panelId)
              }}
            >
              <XIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Close panel</TooltipContent>
        </Tooltip>
        )}
      </div>
    </div>
  )
}
