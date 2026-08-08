import type { AgentCliDriver } from "@yaade/ui/agent-picker"

export type HqAgentLaunchIntent = {
  id: string
  projectId: string
  driverId: AgentCliDriver["id"]
}

/**
 * Module-level HQ → project agent launch queue.
 *
 * React StrictMode remounts wipe component state (`launchRequest`, local claim
 * sets) while an in-flight `openCheckoutSession` still opens the worktree.
 * Keeping the intent here means a remounted ProjectPage can re-seed the mux
 * launch request instead of stranding the user on an empty worktree.
 */
let pending: HqAgentLaunchIntent | null = null

export function queueHqAgentLaunch(intent: HqAgentLaunchIntent): void {
  pending = intent
}

export function peekHqAgentLaunch(
  projectId: string,
): HqAgentLaunchIntent | null {
  return pending?.projectId === projectId ? pending : null
}

export function clearHqAgentLaunch(intentId?: string): void {
  if (!pending) return
  if (intentId && pending.id !== intentId) return
  pending = null
}
