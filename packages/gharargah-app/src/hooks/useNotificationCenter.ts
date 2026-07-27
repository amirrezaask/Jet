import { useCallback, useEffect, useRef, useState } from "react"
import type {
  AppNotification,
  ListNotificationsRequest,
  NotificationCounts,
  NotificationFilter,
  NotificationPreferences,
  NotificationStreamEvent,
} from "@gharargah/shared"
import {
  evaluateDesktopDeliveryClient,
  maybeShowDesktopNotification,
} from "./notification-desktop.js"

const EMPTY_COUNTS: NotificationCounts = {
  totalUnread: 0,
  actionRequired: 0,
  errors: 0,
}

function notificationsApi() {
  return window.gharargah?.notifications
}

export type NotificationCenterState = {
  open: boolean
  setOpen: (open: boolean) => void
  openFiltered: (opts: {
    projectId?: string | null
    sessionId?: string | null
    filter?: NotificationFilter
  }) => void
  items: AppNotification[]
  counts: NotificationCounts
  filter: NotificationFilter
  setFilter: (filter: NotificationFilter) => void
  query: string
  setQuery: (query: string) => void
  projectId: string | null
  sessionId: string | null
  loading: boolean
  error: string | null
  prefs: NotificationPreferences | null
  selectedId: string | null
  setSelectedId: (id: string | null) => void
  refresh: () => Promise<void>
  markRead: (id: string) => Promise<void>
  markUnread: (id: string) => Promise<void>
  dismiss: (id: string) => Promise<void>
  acknowledge: (id: string) => Promise<void>
  markAllVisibleRead: () => Promise<void>
  ingestForTests: (
    req: import("@gharargah/shared").IngestNotificationRequest,
  ) => Promise<unknown>
  bindSession: (
    req: import("@gharargah/shared").BindNotificationSessionRequest,
  ) => Promise<void>
  viewingSessionId: string | null
  setViewingSessionId: (id: string | null) => void
}

export function useNotificationCenter(): NotificationCenterState {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AppNotification[]>([])
  const [counts, setCounts] = useState<NotificationCounts>(EMPTY_COUNTS)
  const [filter, setFilter] = useState<NotificationFilter>("all")
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [projectId, setProjectId] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [viewingSessionId, setViewingSessionId] = useState<string | null>(null)
  const recentDesktop = useRef(new Map<string, number>())

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query), 200)
    return () => window.clearTimeout(t)
  }, [query])

  const refresh = useCallback(async () => {
    const api = notificationsApi()
    if (!api) return
    setLoading(true)
    try {
      const req: ListNotificationsRequest = {
        filter,
        query: debouncedQuery || undefined,
        projectId: projectId ?? undefined,
        sessionId: sessionId ?? undefined,
        limit: 100,
      }
      const [list, preferences] = await Promise.all([
        api.list(req),
        prefs ? Promise.resolve(prefs) : api.getPreferences(),
      ])
      setItems(list.items)
      setCounts(list.counts)
      if (!prefs) setPrefs(preferences)
      setError(null)
    } catch (err) {
      setError("Could not refresh notifications")
      console.error("[gharargah] notifications refresh failed", err)
    } finally {
      setLoading(false)
    }
  }, [filter, debouncedQuery, projectId, sessionId, prefs])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const api = notificationsApi()
    if (!api?.onEvent) return
    return api.onEvent((event: NotificationStreamEvent) => {
      if (event.type === "notification.counts-updated") {
        setCounts(event.counts)
        return
      }
      if (event.type === "notification.created") {
        const n = event.notification
        setItems(prev => {
          if (prev.some(x => x.id === n.id)) {
            return prev.map(x => (x.id === n.id ? n : x))
          }
          return [n, ...prev]
        })
        const decision = evaluateDesktopDeliveryClient({
          prefs,
          notification: n,
          viewingSessionId,
          recentDesktop: recentDesktop.current,
        })
        if (decision.deliver) {
          recentDesktop.current.set(n.id, Date.now())
          maybeShowDesktopNotification(n)
        }
        // Announce high-priority for SR
        if (n.severity === "error" || n.requiresAction) {
          const live = document.getElementById("gharargah-notification-live")
          if (live) live.textContent = `${n.title}. ${n.message ?? ""}`
        }
        void refresh()
        return
      }
      if (
        event.type === "notification.updated" ||
        event.type === "notification.dismissed"
      ) {
        void refresh()
      }
    })
  }, [prefs, viewingSessionId, refresh])

  // Reconcile after reconnect / visibility
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh()
    }
    document.addEventListener("visibilitychange", onVis)
    return () => document.removeEventListener("visibilitychange", onVis)
  }, [refresh])

  const openFiltered: NotificationCenterState["openFiltered"] = opts => {
    setProjectId(opts.projectId ?? null)
    setSessionId(opts.sessionId ?? null)
    if (opts.filter) setFilter(opts.filter)
    setOpen(true)
  }

  const markRead = async (id: string) => {
    await notificationsApi()?.markRead(id)
    await refresh()
  }
  const markUnread = async (id: string) => {
    await notificationsApi()?.markUnread(id)
    await refresh()
  }
  const dismiss = async (id: string) => {
    await notificationsApi()?.dismiss(id)
    await refresh()
  }
  const acknowledge = async (id: string) => {
    await notificationsApi()?.acknowledge(id)
    await refresh()
  }
  const markAllVisibleRead = async () => {
    await notificationsApi()?.markAllRead({
      onlyVisible: true,
      filter,
      projectId: projectId ?? undefined,
      sessionId: sessionId ?? undefined,
      query: debouncedQuery || undefined,
    })
    await refresh()
  }

  return {
    open,
    setOpen: next => {
      if (!next) {
        setProjectId(null)
        setSessionId(null)
      }
      setOpen(next)
    },
    openFiltered,
    items,
    counts,
    filter,
    setFilter,
    query,
    setQuery,
    projectId,
    sessionId,
    loading,
    error,
    prefs,
    selectedId,
    setSelectedId,
    refresh,
    markRead,
    markUnread,
    dismiss,
    acknowledge,
    markAllVisibleRead,
    ingestForTests: req => notificationsApi()!.ingest(req),
    bindSession: async req => {
      await notificationsApi()?.bindSession(req)
    },
    viewingSessionId,
    setViewingSessionId,
  }
}
