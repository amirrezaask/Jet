import type { PanelId } from "@yaade/shared"
import type {
  SessionCardModel,
  SessionProvider,
  TerminalRuntimeStatus,
} from "./session-card-model.js"

/** Terminal/session row used by Mission Control sidebar mapping. */
export type HomeTerminalEntry = {
  tabId: string
  panelId: PanelId
  label: string
  status: TerminalRuntimeStatus
  exitCode?: number
  launchCommand?: string
  agentId?: SessionProvider
  archivedAt?: string
  /** Precomputed presentation model when available. */
  session?: SessionCardModel
  /** Unread from ADE snapshot / notification center. */
  unreadCount?: number
  activityLabel?: string
  statsLine?: string
  requiresApproval?: boolean
  adeStatus?: SessionCardModel["status"]
}

export type HomeProjectGroup = {
  id: string
  name: string
  path: string
  rootUri: string
  terminals: HomeTerminalEntry[]
}
