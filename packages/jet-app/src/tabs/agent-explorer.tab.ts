import { createElement } from "react"
import type { TabType } from "@jet/ui"
import { AgentExplorerTab } from "@jet/ui"
import type { TabContributorDeps } from "./deps.js"

import type { KnownTabKind } from "@jet/workspace"

export const AGENT_EXPLORER_TAB_TYPE_ID: KnownTabKind = "agent-explorer"
export const AGENT_EXPLORER_TAB_ID = "jet:agent-explorer"

export type AgentExplorerTabState = Record<string, never>

export function createAgentExplorerTabType(
  deps: TabContributorDeps,
): TabType<AgentExplorerTabState> {
  return {
    id: AGENT_EXPLORER_TAB_TYPE_ID,
    title: () => "Agents",
    render: () =>
      createElement(AgentExplorerTab, {
        groups: deps.getAgentExplorerGroups(),
        onOpenThread: (rootUri: string, threadId: string) => {
          void deps.openAgentThread(rootUri, threadId)
        },
        onCreateThread: (rootUri: string, rootPath: string) =>
          deps.createAgentThread(rootUri, rootPath),
        onArchiveThread: (rootUri: string, rootPath: string, threadId: string) => {
          void deps.archiveAgentThread(rootUri, rootPath, threadId)
        },
        onUnarchiveThread: (rootUri: string, rootPath: string, threadId: string) => {
          void deps.unarchiveAgentThread(rootUri, rootPath, threadId)
        },
      }),
    keepMounted: true,
  }
}
