export const AGENT_CHAT_TAB_ID_PREFIX = "gharargah:agent-chat:"

export type AgentChatTabState = {
  rootUri: string
  threadId: string
}

export function agentChatTabId(rootUri: string, threadId: string): string {
  return `${AGENT_CHAT_TAB_ID_PREFIX}${encodeURIComponent(rootUri)}:${threadId}`
}

export function parseAgentChatTabId(tabId: string): AgentChatTabState | null {
  if (!tabId.startsWith(AGENT_CHAT_TAB_ID_PREFIX)) return null
  const suffix = tabId.slice(AGENT_CHAT_TAB_ID_PREFIX.length)
  const separator = suffix.lastIndexOf(":")
  if (separator < 0) return null
  return {
    rootUri: decodeURIComponent(suffix.slice(0, separator)),
    threadId: suffix.slice(separator + 1),
  }
}
