import { Bell } from "lucide-react"
import type { NotificationCounts } from "@gharargah/shared"
import { Button } from "@/components/ui/button.js"
import { cn } from "@/lib/utils.js"

export type NotificationBellProps = {
  counts: NotificationCounts
  onClick: () => void
  className?: string
}

export function NotificationBell(props: NotificationBellProps) {
  const { counts, onClick, className } = props
  const unread = counts.totalUnread
  const action = counts.actionRequired > 0
  const hasError = counts.errors > 0

  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      className={cn(
        "relative size-8",
        action && "ring-1 ring-amber-500/60",
        hasError && "ring-1 ring-destructive/70",
        className,
      )}
      data-gharargah-notification-bell
      data-unread={unread}
      data-action-required={action ? "true" : "false"}
      data-has-errors={hasError ? "true" : "false"}
      aria-label={
        unread > 0
          ? `Notification center, ${unread} unread${
              action ? `, ${counts.actionRequired} need action` : ""
            }`
          : "Notification center"
      }
      onClick={onClick}
    >
      <Bell className="size-4" />
      {unread > 0 ? (
        <span
          data-gharargah-notification-badge
          className={cn(
            "absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-4xs font-semibold text-primary-foreground",
            hasError
              ? "bg-destructive"
              : action
                ? "bg-amber-500"
                : "bg-primary",
          )}
        >
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Button>
  )
}
