import { useSyncExternalStore } from "react"
import {
  GharargahHome,
  adeFieldsFromSnapshot,
  mapAgentStatusToCardStatus,
  type GharargahHomeProps,
  type HomeProjectGroup,
} from "@gharargah/ui"
import {
  getAgentSnapshot,
  getAgentTelemetryVersion,
  subscribeAgentTelemetryVersion,
} from "./agent-snapshot-store.js"

type HomeCardsWithAdeProps = Omit<GharargahHomeProps, "groups"> & {
  groups: HomeProjectGroup[]
  unreadBySession?: Record<string, number>
}

/**
 * Owns the ADE telemetry subscription so agent stream events do NOT re-render
 * the whole App (Monaco typing) — only the home card grid.
 */
export function HomeCardsWithAde({
  groups,
  unreadBySession,
  ...homeProps
}: HomeCardsWithAdeProps) {
  const agentTelemetryRevision = useSyncExternalStore(
    subscribeAgentTelemetryVersion,
    getAgentTelemetryVersion,
    getAgentTelemetryVersion,
  )
  void agentTelemetryRevision

  const enriched: HomeProjectGroup[] = groups.map(g => ({
    ...g,
    terminals: g.terminals.map(t => {
      const snap = getAgentSnapshot(t.tabId)
      const ade = adeFieldsFromSnapshot(snap)
      return {
        ...t,
        unreadCount: ade.unreadCount ?? unreadBySession?.[t.tabId] ?? t.unreadCount,
        activityLabel: ade.activityLabel ?? t.activityLabel,
        statsLine: ade.statsLine ?? t.statsLine,
        requiresApproval:
          ade.attentionKind === "permission_required" || t.requiresApproval,
        adeStatus: snap
          ? mapAgentStatusToCardStatus(snap.status, Boolean(t.archivedAt))
          : t.adeStatus,
      }
    }),
  }))

  return <GharargahHome {...homeProps} groups={enriched} />
}
