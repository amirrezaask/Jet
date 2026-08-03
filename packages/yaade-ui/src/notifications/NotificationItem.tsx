import { useEffect, useRef, useState } from "react"
import type { AppNotification, NotificationSeverity } from "@yaade/shared"
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

/** Horizontal two-finger scroll (trackpad wheel deltaX) past this px dismisses. */
const DISMISS_SCROLL_THRESHOLD = 72
const DISMISS_VISUAL_CAP = 112

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

  const rootRef = useRef<HTMLDivElement>(null)
  const accumX = useRef(0)
  const settleTimer = useRef<number | null>(null)
  const [offsetX, setOffsetX] = useState(0)
  const dismissing = useRef(false)

  useEffect(() => {
    const el = rootRef.current
    if (!el || !onDismiss) return

    const resetOffset = () => {
      accumX.current = 0
      setOffsetX(0)
    }

    const onWheel = (e: WheelEvent) => {
      if (dismissing.current) return
      // Two-finger horizontal scroll: require dominant deltaX over vertical list scroll.
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.15) return
      e.preventDefault()
      e.stopPropagation()

      accumX.current += e.deltaX
      const visual = Math.max(
        -DISMISS_VISUAL_CAP,
        Math.min(DISMISS_VISUAL_CAP, accumX.current),
      )
      setOffsetX(visual)

      if (settleTimer.current != null) window.clearTimeout(settleTimer.current)
      settleTimer.current = window.setTimeout(() => {
        if (!dismissing.current && Math.abs(accumX.current) < DISMISS_SCROLL_THRESHOLD) {
          resetOffset()
        }
      }, 180)

      if (Math.abs(accumX.current) >= DISMISS_SCROLL_THRESHOLD) {
        dismissing.current = true
        if (settleTimer.current != null) window.clearTimeout(settleTimer.current)
        setOffsetX(accumX.current > 0 ? DISMISS_VISUAL_CAP : -DISMISS_VISUAL_CAP)
        onDismiss()
      }
    }

    el.addEventListener("wheel", onWheel, { passive: false, capture: true })
    return () => {
      el.removeEventListener("wheel", onWheel, true)
      if (settleTimer.current != null) window.clearTimeout(settleTimer.current)
    }
  }, [onDismiss])

  return (
    <div
      ref={rootRef}
      role="option"
      aria-selected={selected}
      data-yaade-notification-item
      data-notification-id={n.id}
      data-status={n.status}
      data-severity={n.severity}
      data-requires-action={actionable ? "true" : "false"}
      data-unread={unread ? "true" : "false"}
      className={cn(
        "group relative flex w-full items-start gap-2 overflow-hidden rounded-md border border-transparent px-2 py-1.5 text-left transition-colors",
        "hover:bg-accent/60 focus-within:bg-accent/60",
        selected && "border-border bg-accent/70",
        unread && "bg-accent/30",
      )}
      style={{
        transform: offsetX ? `translateX(${offsetX}px)` : undefined,
        opacity: Math.max(0.35, 1 - Math.abs(offsetX) / (DISMISS_VISUAL_CAP * 1.4)),
        transition:
          offsetX === 0
            ? "transform 160ms var(--yaade-ease-out, ease-out), opacity 160ms var(--yaade-ease-out, ease-out)"
            : undefined,
      }}
      title="Two-finger scroll sideways to dismiss"
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
            data-yaade-notification-item-menu
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
