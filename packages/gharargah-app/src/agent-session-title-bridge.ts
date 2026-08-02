import {
  shouldApplyAgentSessionTitle,
  titleFromUserPrompt,
} from "./agent-session-title.js"
import { setAgentSessionTitle, terminalSessionForTab } from "./tabs/terminal-session.js"

type AgentStreamEvent = {
  type: string
  sessionId: string
  event?: {
    kind?: string
    provider?: string
    metadata?: Record<string, string | number | boolean | null>
  }
}

type TabLabelUpdater = (tabId: string, label: string) => void

let tabLabelUpdater: TabLabelUpdater | null = null
let installed = false

/** App wires tabRegistry updates here (host bridge has no workspace). */
export function setAgentSessionTitleTabUpdater(updater: TabLabelUpdater | null): void {
  tabLabelUpdater = updater
}

/**
 * Subscribe once at boot (main.tsx) so first-prompt titles land even if a React
 * effect misses the agents.onEvent registration race.
 */
export function installAgentSessionTitleBridge(): () => void {
  if (installed) return () => undefined
  const api = window.gharargah?.agents
  if (!api?.onEvent) return () => undefined
  installed = true
  return api.onEvent(payload => {
    applySessionTitleFromAgentEvent(payload as AgentStreamEvent)
  })
}

export function applySessionTitleFromAgentEvent(payload: AgentStreamEvent): void {
  if (payload.type !== "agents.event" || payload.event?.kind !== "prompt.submitted") {
    return
  }
  const promptRaw = payload.event.metadata?.prompt
  if (typeof promptRaw !== "string") return
  const session = terminalSessionForTab(payload.sessionId)
  if (!session || session.customLabel) return
  const nextTitle = titleFromUserPrompt(promptRaw)
  if (
    !nextTitle ||
    !shouldApplyAgentSessionTitle(
      nextTitle,
      session.agentTitle,
      session.agentId ?? payload.event.provider,
    )
  ) {
    return
  }
  setAgentSessionTitle(payload.sessionId, nextTitle)
  tabLabelUpdater?.(payload.sessionId, nextTitle)
}
