import type {
  AgentEvent,
  AgentSessionSnapshot,
} from "@gharargah/agents"
import {
  describeAgentActivity,
  formatDurationMs,
} from "@gharargah/agents"
import type { SessionCardStatus, SessionProvider } from "./session-card-model.js"
import {
  mapRuntimeStatusToCardStatus,
  sessionAgentLabel,
} from "./session-card-model.js"

export type AdeSessionCardFields = {
  activityLabel?: string
  unreadCount?: number
  statsLine?: string
  attentionKind?: NonNullable<AgentSessionSnapshot["attention"]>["kind"]
}

export function mapAgentStatusToCardStatus(
  status: AgentSessionSnapshot["status"],
  done?: boolean,
): SessionCardStatus {
  if (done) return "done"
  switch (status) {
    case "waiting_for_permission":
      return "approval"
    case "failed":
    case "terminated":
      return "failed"
    case "completed":
      return "done"
    case "waiting_for_user":
    case "idle":
    case "disconnected":
      return "idle"
    case "running_tool":
      return "testing"
    case "working":
    case "starting":
      return "running"
    default:
      return "running"
  }
}

export function adeFieldsFromSnapshot(
  snap: Omit<AgentSessionSnapshot, "_internal"> | null | undefined,
  nowMs = Date.now(),
): AdeSessionCardFields {
  if (!snap) return {}
  const caps = snap.capabilities
  const parts: string[] = []
  const activeMs =
    snap.currentTurn != null
      ? Math.max(0, nowMs - Date.parse(snap.currentTurn.startedAt))
      : snap.runtime.activeRuntimeMs
  if (activeMs > 0) {
    parts.push(`${formatDurationMs(activeMs)} active`)
  } else if (snap.runtime.processRuntimeMs > 0) {
    parts.push(`${formatDurationMs(snap.runtime.processRuntimeMs)} runtime`)
  }
  if (snap.counts.turns > 0) parts.push(`${snap.counts.turns} turns`)
  if (caps.toolLifecycle && snap.counts.tools > 0) {
    parts.push(`${snap.counts.tools} tools`)
  }
  if (caps.fileEvents !== "unsupported" && snap.counts.touchedFiles > 0) {
    parts.push(`${snap.counts.touchedFiles} files`)
  }
  if (caps.subagents && (snap.counts.subagents ?? 0) > 0) {
    parts.push(`${snap.counts.subagents} subagents`)
  }
  return {
    activityLabel: describeAgentActivity(snap as AgentSessionSnapshot),
    unreadCount: snap.unread.count || undefined,
    statsLine: parts.length > 0 ? parts.join(" · ") : undefined,
    attentionKind: snap.attention?.kind,
  }
}

export function cardModelFromAdeSnapshot(input: {
  id: string
  projectId: string
  title: string
  agentId?: SessionProvider
  snapshot?: Omit<AgentSessionSnapshot, "_internal"> | null
  runtimeStatus?: "starting" | "running" | "exited" | "failed"
  done?: boolean
  nowMs?: number
}): import("./session-card-model.js").SessionCardModel & AdeSessionCardFields {
  const ade = adeFieldsFromSnapshot(input.snapshot, input.nowMs)
  const status = input.snapshot
    ? mapAgentStatusToCardStatus(input.snapshot.status, input.done)
    : mapRuntimeStatusToCardStatus(input.runtimeStatus ?? "running", input.done)
  return {
    id: input.id,
    projectId: input.projectId,
    kind: "session",
    agentId: input.agentId,
    agentLabel: sessionAgentLabel(input.agentId),
    title: input.title,
    description: ade.activityLabel,
    status,
    requiresApproval: ade.attentionKind === "permission_required",
    unreadCount: ade.unreadCount,
    statsLine: ade.statsLine,
    ...ade,
  }
}

export type { AgentEvent, AgentSessionSnapshot }
