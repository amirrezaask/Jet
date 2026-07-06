import { createElement } from "react"
import type { AgentProviderKind } from "@jet/agents"
import type { TabType } from "@jet/ui"
import { AgentSessionPanel } from "@jet/ui"
import type { TabContributorDeps } from "./deps.js"

export const AGENT_TAB_TYPE_ID = "agent"

export type AgentTabState = {
  sessionId: string
  folderId: string
  provider: AgentProviderKind
  label: string
}

export function createAgentTabType(deps: TabContributorDeps): TabType<AgentTabState> {
  return {
    id: AGENT_TAB_TYPE_ID,
    keepMounted: true,
    title: state => state.label,
    dirty: _state => {
      return false
    },
    dispose: instance => {
      const doc = deps.workspace.folderStateForAgentTab(instance.id)?.agents.get(instance.id)
      if (doc && window.jet?.agents) {
        void window.jet.agents.stopSession(doc.sessionId)
      }
      deps.workspace.disposeAgentSession(instance.id)
    },
    render: (instance, ctx) =>
      createElement(AgentSessionPanel, {
        tabId: instance.id,
        workspace: deps.workspace,
        focused: ctx.focused,
        isActive: ctx.isActive,
      }),
  }
}
