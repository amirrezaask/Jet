import { useEffect, useMemo, useRef, useState } from "react"
import type { AppNotification } from "@gharargah/shared"
import { Bell, CheckCheck, LoaderCircle } from "lucide-react"
import { Button } from "@/components/ui/button.js"
import { Input } from "@/components/ui/input.js"
import { ScrollArea } from "@/components/ui/scroll-area.js"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet.js"
import { groupNotificationsByTime } from "./group-by-time.js"
import { NotificationItem } from "./NotificationItem.js"

export type NotificationCenterProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: AppNotification[]
  query: string
  onQueryChange: (query: string) => void
  loading?: boolean
  error?: string | null
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

export function NotificationCenter(props: NotificationCenterProps) {
  const {
    open,
    onOpenChange,
    items,
    query,
    onQueryChange,
    loading,
    error,
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

  const listRef = useRef<HTMLDivElement>(null)
  const [localSelected, setLocalSelected] = useState<string | null>(null)
  const activeSelected = selectedId ?? localSelected
  const setSelected = (id: string | null) => {
    onSelectedIdChange?.(id)
    setLocalSelected(id)
  }

  const groups = useMemo(() => groupNotificationsByTime(items), [items])
  const flatIds = useMemo(() => items.map(i => i.id), [items])

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
        aria-label="Notification center"
      >
        <SheetHeader className="border-b border-border/60 px-3 py-2 text-left">
          <SheetTitle className="sr-only">Notification center</SheetTitle>
          <div className="flex items-center gap-2">
            <Input
              data-gharargah-notification-search
              value={query}
              onChange={e => onQueryChange(e.target.value)}
              placeholder="Search notifications…"
              className="h-8 min-w-0 flex-1 text-xs"
              aria-label="Search notifications"
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 shrink-0 gap-1 px-2 text-3xs"
              data-gharargah-notification-mark-all-read
              onClick={onMarkAllRead}
            >
              <CheckCheck className="size-3.5" />
              Mark all as read
            </Button>
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
          <ScrollArea className="h-[calc(100vh-4.5rem)]">
            <div
              ref={listRef}
              role="listbox"
              aria-label="Unread notifications"
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
                  <p className="text-xs font-medium text-foreground">No unread notifications</p>
                  <p className="max-w-[16rem] text-3xs text-muted-foreground">
                    You’re caught up.
                  </p>
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
