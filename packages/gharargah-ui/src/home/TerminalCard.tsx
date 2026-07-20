import { Terminal as TerminalIcon, X } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.js"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu.js"
import { cn } from "@/lib/utils.js"

export type TerminalCardStatus = "starting" | "running" | "exited" | "failed"

export type TerminalCardProps = {
  label: string
  status: TerminalCardStatus
  exitCode?: number
  onClick: () => void
  onKill?: () => void
}

function statusLabel(status: TerminalCardStatus, exitCode?: number): string {
  switch (status) {
    case "starting":
      return "Starting"
    case "running":
      return "Running"
    case "failed":
      return "Failed"
    case "exited":
      return exitCode === undefined ? "Exited" : `Exited (${exitCode})`
  }
}

function statusClass(status: TerminalCardStatus): string {
  switch (status) {
    case "running":
    case "starting":
      return "text-primary"
    case "failed":
      return "text-destructive"
    case "exited":
      return "text-muted-foreground"
  }
}

function showStatusDot(status: TerminalCardStatus): boolean {
  return status === "running" || status === "starting"
}

export function TerminalCard(props: TerminalCardProps) {
  const { label, status, exitCode, onClick, onKill } = props
  const card = (
    <button
      type="button"
      data-gharargah-terminal-card
      data-gharargah-list-item
      data-status={status}
      className="group text-left outline-none"
      onClick={onClick}
    >
      <Card
        className={cn(
          "gharargah-home-session-card h-full min-w-[11rem] gap-3 border-border/80 bg-card/80 py-4 transition-[border-color,box-shadow,background-color]",
          "hover:border-primary/50 hover:bg-card",
          "group-focus-visible:border-ring group-focus-visible:ring-[3px] group-focus-visible:ring-ring/40",
        )}
      >
        <CardHeader className="gap-2 px-4 [.border-b]:pb-0">
          <div className="flex items-center gap-2">
            <TerminalIcon className="size-4 shrink-0 text-muted-foreground" />
            <CardTitle className="min-w-0 flex-1 truncate text-sm font-medium">{label}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-4">
          <p className={cn("text-xs tabular-nums", statusClass(status))}>
            {showStatusDot(status) ? (
              <span data-gharargah-terminal-status-dot aria-hidden="true" />
            ) : null}
            {statusLabel(status, exitCode)}
          </p>
        </CardContent>
      </Card>
    </button>
  )

  if (!onKill) return card

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
      <ContextMenuContent data-gharargah-terminal-card-menu>
        <ContextMenuItem
          variant="destructive"
          onSelect={onKill}
        >
          <X className="size-4" />
          Kill Terminal
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
