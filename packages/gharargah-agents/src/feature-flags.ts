/**
 * In-app ACP/SDK agent chat. ADE product path uses agent CLIs in PTYs instead.
 * Opt in with GHARARGAH_ENABLE_AGENT_CHAT=1 (tests / recovery).
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
