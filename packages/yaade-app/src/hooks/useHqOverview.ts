import { useCallback, useEffect, useRef, useState } from "react"
import { HqSnapshot } from "@yaade/rpc"
import { Schema } from "effect"

export type HqOverviewState = {
  snapshot: HqSnapshot | null
  loading: boolean
  refreshing: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useHqOverview(): HqOverviewState {
  const [snapshot, setSnapshot] = useState<HqSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sequence = useRef(0)
  const unseenRefreshTimer = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    const current = ++sequence.current
    setRefreshing(true)
    try {
      const response = await fetch("/api/v1/hq", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      })
      if (!response.ok) throw new Error(`HQ request failed (${response.status})`)
      const decoded = Schema.decodeUnknownSync(HqSnapshot)(await response.json())
      if (current !== sequence.current) return
      setSnapshot(decoded)
      setError(null)
    } catch (cause) {
      if (current !== sequence.current) return
      setError(cause instanceof Error ? cause.message : "HQ is unavailable")
    } finally {
      if (current === sequence.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => void refresh(), 30_000)
    const reconcile = () => {
      if (document.visibilityState === "visible") void refresh()
    }
    const onAgentSignal = () => {
      if (unseenRefreshTimer.current != null) return
      unseenRefreshTimer.current = window.setTimeout(() => {
        unseenRefreshTimer.current = null
        void refresh()
      }, 250)
    }
    const offExit = window.yaade?.terminal?.onExit(() => void refresh())
    window.addEventListener("focus", reconcile)
    window.addEventListener("yaade:agent-signal", onAgentSignal)
    window.addEventListener("yaade:notification-signal", onAgentSignal)
    document.addEventListener("visibilitychange", reconcile)
    return () => {
      window.clearInterval(interval)
      if (unseenRefreshTimer.current != null) {
        window.clearTimeout(unseenRefreshTimer.current)
      }
      offExit?.()
      window.removeEventListener("focus", reconcile)
      window.removeEventListener("yaade:agent-signal", onAgentSignal)
      window.removeEventListener("yaade:notification-signal", onAgentSignal)
      document.removeEventListener("visibilitychange", reconcile)
    }
  }, [refresh])

  return { snapshot, loading, refreshing, error, refresh }
}
