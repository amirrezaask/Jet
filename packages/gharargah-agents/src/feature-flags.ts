/** Agent chat is a product surface; set GHARARGAH_ENABLE_AGENT_CHAT=0 only for recovery builds. */
export function isAgentChatEnabled(): boolean {
  const env = (import.meta as ImportMeta & { env?: { GHARARGAH_ENABLE_AGENT_CHAT?: string } }).env
  return env?.GHARARGAH_ENABLE_AGENT_CHAT !== "0"
}

/** Agents control plane: Effect agent-server by default. Set GHARARGAH_AGENT_RUNTIME=rust only for emergency (Rust path removed). */
export function isEffectAgentRuntime(): boolean {
  const env = (import.meta as ImportMeta & { env?: { GHARARGAH_AGENT_RUNTIME?: string } }).env
  return env?.GHARARGAH_AGENT_RUNTIME !== "rust"
}
