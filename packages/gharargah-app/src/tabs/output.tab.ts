import { createElement } from "react"
import type { TabType } from "@gharargah/ui"
import { OutputPanel } from "@gharargah/ui"
import type { TabContributorDeps } from "./deps.js"

import type { KnownTabKind } from "@gharargah/workspace"

export const OUTPUT_TAB_TYPE_ID: KnownTabKind = "output"

export type OutputTabState = Record<string, never>

export function createOutputTabType(deps: TabContributorDeps): TabType<OutputTabState> {
  return {
    id: OUTPUT_TAB_TYPE_ID,
    title: () => "Output",
    render: () =>
      createElement(OutputPanel, {
        workspace: deps.workspace,
      }),
  }
}
