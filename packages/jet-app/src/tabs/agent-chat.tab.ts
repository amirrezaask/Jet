import { createElement } from "react"
import { isDarkTheme } from "@jet/codemirror"
import type { TabType } from "@jet/ui"
import { AgentChatView } from "@jet/ui"
import type { TabContributorDeps } from "./deps.js"

export const AGENT_CHAT_TAB_TYPE_ID = "agent-chat"
export const AGENT_CHAT_TAB_ID_PREFIX = "jet:agent-chat:"

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

export function createAgentChatTabType(deps: TabContributorDeps): TabType<AgentChatTabState> {
  return {
    id: AGENT_CHAT_TAB_TYPE_ID,
    title: state =>
      deps.getAgentThread(state.rootUri, state.threadId)?.title ??
      deps.getAgentSnapshot(state.rootUri)?.threads.find(thread => thread.id === state.threadId)?.title ??
      "Agent",
    render: instance =>
      createElement(AgentChatView, {
        thread: deps.getAgentThread(instance.state.rootUri, instance.state.threadId),
        providers: deps.getAgentProviders(),
        theme: isDarkTheme(deps.getTheme()) ? "dark" : "light",
        onSend: payload =>
          deps.sendAgentMessage(instance.state.rootUri, instance.state.threadId, payload),
      }),
    keepMounted: true,
  }
}
