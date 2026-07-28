import { Code2, SquareTerminal } from "lucide-react"
import { ClaudeAI, CursorIcon, OpenAI, type Icon } from "../../agents/composer/Icons.js"
import { cn } from "@/lib/utils.js"
import type { SidebarSessionStatus } from "./types.js"

export function AgentProviderIcon({
  agent,
  className,
}: {
  agent: string
  className?: string
}) {
  const cls = cn("size-3.5 shrink-0", className)
  const id = agent.toLowerCase()
  if (id === "terminal" || id === "shell") {
    return <SquareTerminal className={cn(cls, "text-muted-foreground")} aria-hidden />
  }
  const IconComp: Icon | null =
    id === "claude"
      ? ClaudeAI
      : id === "cursor"
        ? CursorIcon
        : id === "codex"
          ? OpenAI
          : id === "opencode"
            ? Code2
            : null
  if (IconComp) return <IconComp className={cls} aria-hidden />
  return <SquareTerminal className={cn(cls, "text-muted-foreground")} aria-hidden />
}

const STATUS_LABEL: Record<SidebarSessionStatus, string> = {
  running: "Running",
  waiting: "Waiting for user",
  completed: "Completed",
  failed: "Failed",
  disconnected: "Disconnected",
}

const STATUS_CLASS: Record<SidebarSessionStatus, string> = {
  running: "bg-[var(--home-status-running,var(--gharargah-success,#22c55e))]",
  waiting: "bg-[var(--home-status-approval,var(--gharargah-warning,#f59e0b))]",
  completed: "bg-muted-foreground/50",
  failed: "bg-destructive",
  disconnected: "border border-muted-foreground/60 bg-transparent",
}

export function SessionStatusIndicator({
  status,
}: {
  status: SidebarSessionStatus
}) {
  const label = STATUS_LABEL[status]
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("size-1.5 shrink-0 rounded-full", STATUS_CLASS[status])}
      data-gharargah-session-status={status}
    />
  )
}

export { STATUS_LABEL as SIDEBAR_STATUS_LABEL }
