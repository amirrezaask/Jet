import { createElement } from "react"
import type { TabType } from "@jet/ui"
import { OutputPanel } from "@jet/ui"
import type { TabContributorDeps } from "./deps.js"

export const OUTPUT_TAB_TYPE_ID = "output"

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
