import { createElement } from "react"
import type { AgentThread } from "@jet/agents"
import type { TabType } from "@jet/ui"
import { AgentChatTabBody } from "./AgentChatTabBody.js"
import type { TabContributorDeps } from "./deps.js"
import {
  AGENT_CHAT_TAB_ID_PREFIX,
  agentChatTabId,
  parseAgentChatTabId,
  type AgentChatTabState,
} from "./agent-chat-id.js"

export const AGENT_CHAT_TAB_TYPE_ID = "agent-chat"
export { AGENT_CHAT_TAB_ID_PREFIX, agentChatTabId, parseAgentChatTabId }
export type { AgentChatTabState }

export function createAgentChatTabType(deps: TabContributorDeps): TabType<AgentChatTabState & {
  rev?: string
  thread?: AgentThread | null
}> {
  return {
    id: AGENT_CHAT_TAB_TYPE_ID,
    title: state =>
      deps.getAgentThread(state.rootUri, state.threadId)?.title ??
      deps.getAgentSnapshot(state.rootUri)?.threads.find(thread => thread.id === state.threadId)?.title ??
      "Agent",
    render: instance =>
      createElement(AgentChatTabBody, {
        rootUri: instance.state.rootUri,
        threadId: instance.state.threadId,
        deps,
      }),
    keepMounted: true,
  }
}
