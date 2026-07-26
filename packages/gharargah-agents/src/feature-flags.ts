/** Agent chat is a product surface; set GHARARGAH_ENABLE_AGENT_CHAT=0 only for recovery builds. */
export function isAgentChatEnabled(): boolean {
  const env = (import.meta as ImportMeta & { env?: { GHARARGAH_ENABLE_AGENT_CHAT?: string } }).env
  return env?.GHARARGAH_ENABLE_AGENT_CHAT !== "0"
}
