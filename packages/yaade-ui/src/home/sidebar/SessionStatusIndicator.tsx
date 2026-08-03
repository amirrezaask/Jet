import { SquareTerminal } from "lucide-react"
import {
  ClaudeAI,
  CursorIcon,
  GrokIcon,
  OpenAI,
  OpenCodeIcon,
  type Icon,
} from "../provider-icons.js"
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
            ? OpenCodeIcon
            : id === "grok"
              ? GrokIcon
              : null
  if (IconComp) return <IconComp className={cls} aria-hidden />
  return <SquareTerminal className={cn(cls, "text-muted-foreground")} aria-hidden />
}

const STATUS_LABEL: Record<SidebarSessionStatus, string> = {
  running: "Running",
  waiting: "Waiting for Input",
  completed: "Completed",
  failed: "Failed",
  disconnected: "Disconnected",
}

const STATUS_CLASS: Record<SidebarSessionStatus, string> = {
  running: "bg-[var(--home-status-running,var(--yaade-success,#22c55e))]",
  waiting: "bg-[var(--home-status-approval,var(--yaade-warning,#f59e0b))]",
  completed: "bg-muted-foreground/50",
  failed: "bg-destructive",
  disconnected: "border border-muted-foreground/60 bg-transparent",
}

/** Text status shown on the session meta row; quiet statuses return null. */
const STATUS_TEXT_CLASS: Partial<Record<SidebarSessionStatus, string>> = {
  waiting: "text-[var(--home-status-approval,var(--yaade-warning,#f59e0b))]",
  completed: "text-[var(--home-status-running,var(--yaade-success,#22c55e))]",
  failed: "text-destructive",
}

export function sessionStatusText(
  status: SidebarSessionStatus,
): { text: string; className: string } | null {
  if (status === "waiting" || status === "completed" || status === "failed") {
    return { text: STATUS_LABEL[status], className: STATUS_TEXT_CLASS[status]! }
  }
  return null
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
      data-yaade-session-status={status}
    />
  )
}

export { STATUS_LABEL as SIDEBAR_STATUS_LABEL }
