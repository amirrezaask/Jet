/**
 * In-app ACP/SDK agent chat is temporarily disabled by default.
 * Re-enable with GHARARGAH_ENABLE_AGENT_CHAT=1 at frontend build/dev time.
 */
export function isAgentChatEnabled(): boolean {
  const env = (import.meta as ImportMeta & { env?: { GHARARGAH_ENABLE_AGENT_CHAT?: string } }).env
  return env?.GHARARGAH_ENABLE_AGENT_CHAT === "1"
}
