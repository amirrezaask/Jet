import { createElement } from "react"
import type { TabType } from "@gharargah/ui"
import { ExplorerTab } from "@gharargah/ui"
import type { TabContributorDeps } from "./deps.js"

import type { KnownTabKind } from "@gharargah/workspace"

export const EXPLORER_TAB_TYPE_ID: KnownTabKind = "explorer"

export type ExplorerTabState = Record<string, never>

export function createExplorerTabType(deps: TabContributorDeps): TabType<ExplorerTabState> {
  return {
    id: EXPLORER_TAB_TYPE_ID,
    title: () => "Explorer",
    render: () =>
      createElement(ExplorerTab, {
        manager: deps.workspace.manager,
        onOpenFile: deps.onOpenFile,
      }),
  }
}
