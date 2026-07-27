import { useEffect, useId, useMemo, useRef, useState } from "react"
import type {
  AppNotification,
  NotificationCounts,
  NotificationFilter,
  NotificationPreferences,
} from "@gharargah/shared"
import { Bell, CheckCheck, LoaderCircle, Settings2, X } from "lucide-react"
import { Button } from "@/components/ui/button.js"
import { Input } from "@/components/ui/input.js"
import { ScrollArea } from "@/components/ui/scroll-area.js"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet.js"
import { cn } from "@/lib/utils.js"
import { groupNotificationsByTime } from "./group-by-time.js"
import { NotificationItem } from "./NotificationItem.js"

const FILTERS: { id: NotificationFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "action-needed", label: "Action needed" },
  { id: "completed", label: "Completed" },
  { id: "errors", label: "Errors" },
]

export type NotificationCenterProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: AppNotification[]
  counts: NotificationCounts
  filter: NotificationFilter
  onFilterChange: (filter: NotificationFilter) => void
  query: string
  onQueryChange: (query: string) => void
  loading?: boolean
  error?: string | null
  projectFilter?: string | null
  sessionFilter?: string | null
  prefs?: NotificationPreferences | null
  onOpenSettings?: () => void
  onMarkAllRead: () => void
  onRefresh?: () => void
  isSessionAvailable?: (sessionId: string) => boolean
  onOpenNotification: (n: AppNotification) => void
  onMarkRead: (id: string) => void
  onMarkUnread: (id: string) => void
  onDismiss: (id: string) => void
  onAcknowledge?: (id: string) => void
  selectedId?: string | null
  onSelectedIdChange?: (id: string | null) => void
}

function emptyCopy(filter: NotificationFilter): { title: string; body: string } {
  switch (filter) {
    case "unread":
      return {
        title: "No unread notifications",
        body: "You’re caught up.",
      }
    case "action-needed":
      return {
        title: "No notifications need action",
        body: "Permission and input requests will show up here.",
      }
    case "completed":
      return {
        title: "No completions yet",
        body: "Agent turn completions will appear here.",
      }
    case "errors":
      return {
        title: "No errors",
        body: "Failures and unexpected exits will appear here.",
      }
    default:
      return {
        title: "No notifications yet",
        body: "Agent completions, permission requests, and failures will appear here.",
      }
  }
}

export function NotificationCenter(props: NotificationCenterProps) {
  const {
    open,
    onOpenChange,
    items,
    counts,
    filter,
    onFilterChange,
    query,
    onQueryChange,
    loading,
    error,
    projectFilter,
    sessionFilter,
    onOpenSettings,
    onMarkAllRead,
    isSessionAvailable,
    onOpenNotification,
    onMarkRead,
    onMarkUnread,
    onDismiss,
    onAcknowledge,
    selectedId,
    onSelectedIdChange,
  } = props

  const titleId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const [localSelected, setLocalSelected] = useState<string | null>(null)
  const activeSelected = selectedId ?? localSelected
  const setSelected = (id: string | null) => {
    onSelectedIdChange?.(id)
    setLocalSelected(id)
  }

  const groups = useMemo(() => groupNotificationsByTime(items), [items])
  const flatIds = useMemo(() => items.map(i => i.id), [items])
  const filteredActive = filter !== "all" || Boolean(query.trim()) || Boolean(projectFilter) || Boolean(sessionFilter)
  const empty = emptyCopy(filter)

  useEffect(() => {
    if (!open) return
    if (activeSelected && flatIds.includes(activeSelected)) return
    setSelected(flatIds[0] ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, flatIds.join("|")])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onOpenChange(false)
        return
      }
      if (!flatIds.length) return
      const idx = activeSelected ? flatIds.indexOf(activeSelected) : -1
      if (e.key === "ArrowDown") {
        e.preventDefault()
        const next = flatIds[Math.min(flatIds.length - 1, Math.max(0, idx + 1))]
        if (next) setSelected(next)
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        const prev = flatIds[Math.max(0, idx - 1)]
        if (prev) setSelected(prev)
      } else if (e.key === "Enter" && activeSelected) {
        e.preventDefault()
        const n = items.find(i => i.id === activeSelected)
        if (n) onOpenNotification(n)
      } else if ((e.key === "r" || e.key === "R") && activeSelected && !e.metaKey && !e.ctrlKey) {
        const n = items.find(i => i.id === activeSelected)
        if (!n) return
        e.preventDefault()
        if (n.status === "unread") onMarkRead(n.id)
        else onMarkUnread(n.id)
      } else if ((e.key === "d" || e.key === "D") && activeSelected && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        onDismiss(activeSelected)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [
    open,
    flatIds,
    activeSelected,
    items,
    onOpenChange,
    onOpenNotification,
    onMarkRead,
    onMarkUnread,
    onDismiss,
  ])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        data-gharargah-notification-center
        className="w-full gap-0 p-0 sm:max-w-md"
        aria-labelledby={titleId}
      >
        <SheetHeader className="border-b border-border/60 px-3 py-2.5 text-left">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <SheetTitle id={titleId} className="text-sm font-semibold tracking-tight">
                Notification Center
              </SheetTitle>
              <SheetDescription className="mt-0.5 text-3xs text-muted-foreground">
                {counts.totalUnread} unread
                {counts.actionRequired > 0
                  ? ` · ${counts.actionRequired} need action`
                  : ""}
                {projectFilter ? " · project filter" : ""}
                {sessionFilter ? " · session filter" : ""}
              </SheetDescription>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-3xs"
                data-gharargah-notification-mark-all-read
                onClick={onMarkAllRead}
              >
                <CheckCheck className="size-3.5" />
                {filteredActive ? "Mark visible as read" : "Mark all as read"}
              </Button>
              {onOpenSettings ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="size-7"
                  aria-label="Notification settings"
                  onClick={onOpenSettings}
                >
                  <Settings2 className="size-3.5" />
                </Button>
              ) : null}
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="size-7"
                aria-label="Close notification center"
                onClick={() => onOpenChange(false)}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          </div>
          <Input
            data-gharargah-notification-search
            value={query}
            onChange={e => onQueryChange(e.target.value)}
            placeholder="Search notifications…"
            className="mt-2 h-8 text-xs"
            aria-label="Search notifications"
          />
          <div
            role="tablist"
            aria-label="Notification filters"
            className="mt-2 flex flex-wrap gap-1"
          >
            {FILTERS.map(f => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                data-gharargah-notification-filter={f.id}
                className={cn(
                  "rounded-md px-2 py-1 text-3xs font-medium transition-colors",
                  filter === f.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                onClick={() => onFilterChange(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </SheetHeader>

        <div className="relative min-h-0 flex-1">
          {error ? (
            <p
              data-gharargah-notification-error
              className="border-b border-border/50 bg-destructive/10 px-3 py-1.5 text-3xs text-destructive"
              role="status"
            >
              {error}
            </p>
          ) : null}
          <ScrollArea className="h-[calc(100vh-9.5rem)]">
            <div
              ref={listRef}
              role="listbox"
              aria-label="Notifications"
              data-gharargah-notification-list
              className="flex flex-col gap-3 px-2 py-2"
            >
              {loading && items.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-10 text-3xs text-muted-foreground">
                  <LoaderCircle className="size-3.5 animate-spin" />
                  Loading…
                </div>
              ) : items.length === 0 ? (
                <div
                  data-gharargah-notification-empty
                  className="flex flex-col items-center gap-1 px-4 py-10 text-center"
                >
                  <Bell className="mb-1 size-5 text-muted-foreground/70" />
                  <p className="text-xs font-medium text-foreground">{empty.title}</p>
                  <p className="max-w-[16rem] text-3xs text-muted-foreground">{empty.body}</p>
                </div>
              ) : (
                groups.map(group => (
                  <section key={group.id} data-gharargah-notification-group={group.id}>
                    <h3 className="px-2 pb-1 text-4xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                      {group.label}
                    </h3>
                    <div className="flex flex-col gap-0.5">
                      {group.items.map(n => (
                        <NotificationItem
                          key={n.id}
                          notification={n}
                          selected={activeSelected === n.id}
                          sessionMissing={
                            Boolean(n.sessionId) &&
                            isSessionAvailable != null &&
                            !isSessionAvailable(n.sessionId!)
                          }
                          onOpen={() => {
                            setSelected(n.id)
                            onOpenNotification(n)
                          }}
                          onMarkRead={() => onMarkRead(n.id)}
                          onMarkUnread={() => onMarkUnread(n.id)}
                          onDismiss={() => onDismiss(n.id)}
                          onAcknowledge={
                            onAcknowledge ? () => onAcknowledge(n.id) : undefined
                          }
                        />
                      ))}
                    </div>
                  </section>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  )
}
