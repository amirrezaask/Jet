import type { KnownTabKind } from "@jet/workspace"
import { createElement, type ComponentType } from "react"
import type { LocationListTabProps, TabType } from "@jet/ui"
import {
  SearchLocationList,
  ReferencesLocationList,
  DefinitionsLocationList,
  DiagnosticsLocationList,
  TaskErrorsLocationList,
} from "@jet/ui"
import type { TabContributorDeps } from "./deps.js"

export type ListTabState = { listId: string }

export const SEARCH_TAB_TYPE_ID: KnownTabKind = "search"
export const PROBLEMS_TAB_TYPE_ID: KnownTabKind = "problems"
export const REFERENCES_TAB_TYPE_ID: KnownTabKind = "references"
export const DEFINITIONS_TAB_TYPE_ID: KnownTabKind = "definitions"
export const TASK_ERRORS_TAB_TYPE_ID: KnownTabKind = "task-errors"

function makeListTabType(
  typeId: string,
  Comp: ComponentType<LocationListTabProps>,
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
        getSearchFolders: deps.getSearchFolders,
        ...(options?.autoFocusInput ? { autoFocus: ctx.focused && ctx.isActive } : {}),
      }),
  }
}

export function createSearchTabType(deps: TabContributorDeps): TabType<ListTabState> {
  return makeListTabType(SEARCH_TAB_TYPE_ID, SearchLocationList, deps, { autoFocusInput: true })
}

export function createProblemsTabType(deps: TabContributorDeps): TabType<ListTabState> {
  return makeListTabType(PROBLEMS_TAB_TYPE_ID, DiagnosticsLocationList, deps)
}

export function createReferencesTabType(deps: TabContributorDeps): TabType<ListTabState> {
  return makeListTabType(REFERENCES_TAB_TYPE_ID, ReferencesLocationList, deps)
}

export function createDefinitionsTabType(deps: TabContributorDeps): TabType<ListTabState> {
  return makeListTabType(DEFINITIONS_TAB_TYPE_ID, DefinitionsLocationList, deps)
}

export function createTaskErrorsTabType(deps: TabContributorDeps): TabType<ListTabState> {
  return makeListTabType(TASK_ERRORS_TAB_TYPE_ID, TaskErrorsLocationList, deps)
}
