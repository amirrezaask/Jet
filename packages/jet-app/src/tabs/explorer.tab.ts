import { createElement } from "react"
import type { TabType } from "@jet/ui"
import { ExplorerTab } from "@jet/ui"
import type { TabContributorDeps } from "./deps.js"

export const EXPLORER_TAB_TYPE_ID = "explorer"

export type ExplorerTabState = Record<string, never>

export function createExplorerTabType(deps: TabContributorDeps): TabType<ExplorerTabState> {
  return {
    id: EXPLORER_TAB_TYPE_ID,
    title: () => "Explorer",
    render: () =>
      createElement(ExplorerTab, {
        workspace: deps.workspace,
        onOpenFile: deps.onOpenFile,
      }),
  }
}
