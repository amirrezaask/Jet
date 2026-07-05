import { createElement } from "react"
import type { TabType } from "@jet/ui"
import {
  SearchLocationList,
  ReferencesLocationList,
  DefinitionsLocationList,
  DiagnosticsLocationList,
  TaskErrorsLocationList,
} from "@jet/ui"
import type { TabContributorDeps } from "./deps.js"

export type ListTabState = { listId: string }

export const SEARCH_TAB_TYPE_ID = "search"
export const PROBLEMS_TAB_TYPE_ID = "problems"
export const REFERENCES_TAB_TYPE_ID = "references"
export const DEFINITIONS_TAB_TYPE_ID = "definitions"
export const TASK_ERRORS_TAB_TYPE_ID = "task-errors"

function makeListTabType(
  typeId: string,
  Comp: typeof SearchLocationList,
  deps: TabContributorDeps,
  options?: { autoFocusInput?: boolean },
): TabType<ListTabState> {
  return {
    id: typeId,
    title: state => deps.workspace.listStore.get(state.listId)?.title ?? state.listId,
    render: (instance, ctx) =>
      createElement(Comp, {
        listId: instance.state.listId,
        workspace: deps.workspace,
        onOpenItem: deps.onOpenListItem,
        ...(options?.autoFocusInput ? { autoFocus: ctx.focused && ctx.isActive } : {}),
      }),
  }
}

export function createSearchTabType(deps: TabContributorDeps): TabType<ListTabState> {
  return makeListTabType(SEARCH_TAB_TYPE_ID, SearchLocationList, deps, { autoFocusInput: true })
}

export function createProblemsTabType(deps: TabContributorDeps): TabType<ListTabState> {
  return makeListTabType(PROBLEMS_TAB_TYPE_ID, DiagnosticsLocationList as typeof SearchLocationList, deps)
}

export function createReferencesTabType(deps: TabContributorDeps): TabType<ListTabState> {
  return makeListTabType(REFERENCES_TAB_TYPE_ID, ReferencesLocationList as typeof SearchLocationList, deps)
}

export function createDefinitionsTabType(deps: TabContributorDeps): TabType<ListTabState> {
  return makeListTabType(DEFINITIONS_TAB_TYPE_ID, DefinitionsLocationList as typeof SearchLocationList, deps)
}

export function createTaskErrorsTabType(deps: TabContributorDeps): TabType<ListTabState> {
  return makeListTabType(TASK_ERRORS_TAB_TYPE_ID, TaskErrorsLocationList as typeof SearchLocationList, deps)
}
