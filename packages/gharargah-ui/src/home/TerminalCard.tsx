import { SessionCard } from "./SessionCard.js"
import {
  defaultSessionDescription,
  mapRuntimeStatusToCardStatus,
  providerDisplayLabel,
  type SessionCardStatus,
  type TerminalRuntimeStatus,
} from "./session-card-model.js"

/** @deprecated Prefer SessionCardStatus — kept for modal / explorer compat. */
export type TerminalCardStatus = TerminalRuntimeStatus

export type TerminalCardProps = {
  label: string
  status: TerminalCardStatus
  exitCode?: number
  onClick: () => void
  onKill?: () => void
  kind?: "agent" | "terminal"
  providerLabel?: string
  description?: string
  cardStatus?: SessionCardStatus
}

/** Thin adapter around SessionCard for callers that still pass PTY runtime status. */
export function TerminalCard(props: TerminalCardProps) {
  const {
    label,
    status,
    onClick,
    onKill,
    kind = "terminal",
    providerLabel,
    description,
    cardStatus,
  } = props
  const mapped = cardStatus ?? mapRuntimeStatusToCardStatus(status)
  return (
    <SessionCard
      session={{
        id: label,
        projectId: "",
        kind: "session",
        agentLabel: providerLabel ?? providerDisplayLabel(kind),
        title: label,
        description: description ?? defaultSessionDescription(kind, mapped),
        status: mapped,
      }}
      onClick={onClick}
      onKill={onKill}
    />
  )
}
