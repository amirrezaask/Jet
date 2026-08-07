import { useEffect, useState, useSyncExternalStore } from "react"
import type { AgentEvent, AgentSessionSnapshot } from "@yaade/agents"
import type { HqAgentSummary } from "@yaade/rpc"
import {
  getAgentEvents,
  getAgentSnapshot,
  getAgentTelemetryVersion,
  setAgentSnapshot,
  subscribeAgentTelemetryVersion,
} from "../agent-snapshot-store.js"

export function useLiveAgent(agent: HqAgentSummary | null) {
  useSyncExternalStore(
    subscribeAgentTelemetryVersion,
    getAgentTelemetryVersion,
    getAgentTelemetryVersion,
  )
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const sessionId = agent?.sessionId ?? null

  useEffect(() => {
    if (!sessionId) {
      setEvents([])
      return
    }
    let cancelled = false
    setLoadingHistory(true)
    void Promise.all([
      window.yaade?.agents?.getSnapshot(sessionId) ?? Promise.resolve(null),
      window.yaade?.agents?.listEvents(sessionId, { limit: 40 }) ??
        Promise.resolve([]),
    ])
      .then(([snapshot, history]) => {
        if (cancelled) return
        if (snapshot) {
          setAgentSnapshot(
            sessionId,
            snapshot as Omit<AgentSessionSnapshot, "_internal">,
          )
        }
        setEvents(history)
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId])

  const streamed = sessionId ? getAgentEvents(sessionId) : []
  const mergedEvents = [...events]
  for (const event of streamed) {
    if (!mergedEvents.some(item => item.id === event.id)) mergedEvents.push(event)
  }
  mergedEvents.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))

  return {
    summary: agent,
    snapshot: sessionId ? getAgentSnapshot(sessionId) : null,
    events: mergedEvents,
    loadingHistory,
  }
}
