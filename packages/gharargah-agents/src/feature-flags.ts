/**
 * In-app ACP/SDK agent chat (native driver mode in the session picker).
 * Enabled by default; set GHARARGAH_ENABLE_AGENT_CHAT=0 to hide native mode.
 */
export function isAgentChatEnabled(): boolean {
  const env = (import.meta as ImportMeta & { env?: { GHARARGAH_ENABLE_AGENT_CHAT?: string } }).env
  return env?.GHARARGAH_ENABLE_AGENT_CHAT === "1"
}

/** Agents control plane: Effect agent-server by default. Set GHARARGAH_AGENT_RUNTIME=rust only for emergency (Rust path removed). */
export function isEffectAgentRuntime(): boolean {
  const env = (import.meta as ImportMeta & { env?: { GHARARGAH_AGENT_RUNTIME?: string } }).env
  return env?.GHARARGAH_AGENT_RUNTIME !== "rust"
}
