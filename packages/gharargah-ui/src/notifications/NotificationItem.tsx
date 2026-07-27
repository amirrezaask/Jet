import type { AppNotification, NotificationSeverity } from "@gharargah/shared"
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Info,
  MoreHorizontal,
} from "lucide-react"
import { Button } from "@/components/ui/button.js"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js"
import { cn } from "@/lib/utils.js"
import { formatRelativeTime } from "./group-by-time.js"

export type NotificationItemProps = {
  notification: AppNotification
  selected?: boolean
  sessionMissing?: boolean
  onOpen?: () => void
  onMarkRead?: () => void
  onMarkUnread?: () => void
  onDismiss?: () => void
  onAcknowledge?: () => void
}

function SeverityIcon({
  severity,
  requiresAction,
}: {
  severity: NotificationSeverity
  requiresAction: boolean
}) {
  const className = "size-3.5 shrink-0"
  if (requiresAction) {
    return <AlertTriangle className={cn(className, "text-amber-500")} aria-hidden />
  }
  switch (severity) {
    case "error":
      return <CircleAlert className={cn(className, "text-destructive")} aria-hidden />
    case "success":
      return <CheckCircle2 className={cn(className, "text-emerald-500")} aria-hidden />
    case "warning":
      return <AlertTriangle className={cn(className, "text-amber-500")} aria-hidden />
    default:
      return <Info className={cn(className, "text-muted-foreground")} aria-hidden />
  }
}

export function NotificationItem(props: NotificationItemProps) {
  const {
    notification: n,
    selected,
    sessionMissing,
    onOpen,
    onMarkRead,
    onMarkUnread,
    onDismiss,
    onAcknowledge,
  } = props
  const unread = n.status === "unread"
  const actionable = n.requiresAction && !n.actionResolvedAt
  const meta = [n.provider, n.projectName, n.sessionTitle].filter(Boolean).join(" · ")

  return (
    <div
      role="option"
      aria-selected={selected}
      data-gharargah-notification-item
      data-notification-id={n.id}
      data-status={n.status}
      data-severity={n.severity}
      data-requires-action={actionable ? "true" : "false"}
      data-unread={unread ? "true" : "false"}
      className={cn(
        "group flex w-full items-start gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors",
        "hover:bg-accent/60 focus-within:bg-accent/60",
        selected && "border-border bg-accent/70",
        unread && "bg-accent/30",
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-start gap-2 text-left outline-none"
        onClick={onOpen}
        disabled={sessionMissing && !onOpen}
        aria-label={`${n.title}. ${meta}. ${unread ? "Unread." : "Read."}${
          actionable ? " Action required." : ""
        }${n.severity === "error" ? " Error." : ""}`}
      >
        <span className="mt-0.5 flex size-4 items-center justify-center">
          {unread ? (
            <span
              className={cn(
                "size-1.5 rounded-full",
                actionable
                  ? "bg-amber-500"
                  : n.severity === "error"
                    ? "bg-destructive"
                    : "bg-primary",
              )}
              aria-hidden
            />
          ) : (
            <SeverityIcon
              severity={n.severity}
              requiresAction={actionable}
            />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-xs font-medium text-foreground">{n.title}</span>
            <span className="shrink-0 font-mono text-4xs text-muted-foreground">
              {formatRelativeTime(n.createdAt)}
            </span>
          </span>
          {meta ? (
            <span className="mt-0.5 block truncate text-3xs text-muted-foreground">
              {meta}
              {sessionMissing ? " · session removed" : ""}
            </span>
          ) : sessionMissing ? (
            <span className="mt-0.5 block truncate text-3xs text-muted-foreground">
              Session removed
            </span>
          ) : null}
          {n.message ? (
            <span className="mt-0.5 line-clamp-2 block text-3xs text-muted-foreground/90">
              {n.message}
            </span>
          ) : null}
          {n.actionResolvedAt ? (
            <span className="mt-0.5 block text-4xs text-muted-foreground">Resolved</span>
          ) : actionable ? (
            <span className="mt-0.5 block text-4xs text-amber-600 dark:text-amber-400">
              Action needed
            </span>
          ) : null}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="size-6 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
            aria-label="Notification actions"
            data-gharargah-notification-item-menu
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          {onOpen && !sessionMissing ? (
            <DropdownMenuItem onSelect={onOpen}>Open session</DropdownMenuItem>
          ) : null}
          {unread ? (
            <DropdownMenuItem onSelect={onMarkRead}>Mark as read</DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={onMarkUnread}>Mark as unread</DropdownMenuItem>
          )}
          {actionable && onAcknowledge ? (
            <DropdownMenuItem onSelect={onAcknowledge}>Acknowledge</DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onDismiss}>Dismiss</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
