import { createElement } from "react"
import type { TabType } from "@jet/ui"
import { AgentChatTabBody } from "./AgentChatTabBody.js"
import type { TabContributorDeps } from "./deps.js"
import {
  AGENT_CHAT_TAB_ID_PREFIX,
  agentChatTabId,
  parseAgentChatTabId,
  type AgentChatTabState,
} from "./agent-chat-id.js"

import type { KnownTabKind } from "@jet/workspace"

export const AGENT_CHAT_TAB_TYPE_ID: KnownTabKind = "agent-chat"
export { AGENT_CHAT_TAB_ID_PREFIX, agentChatTabId, parseAgentChatTabId }
export type { AgentChatTabState }

export function createAgentChatTabType(deps: TabContributorDeps): TabType<AgentChatTabState> {
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
    keepMounted: false,
  }
}
