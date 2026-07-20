import type { TabTypeRegistry } from "@gharargah/ui"
import type { TabContributorDeps } from "./deps.js"
import {
  createAgentChatTabType,
  AGENT_CHAT_TAB_TYPE_ID,
} from "./agent-chat.tab.js"
import {
  createAgentExplorerTabType,
  AGENT_EXPLORER_TAB_TYPE_ID,
} from "./agent-explorer.tab.js"
import { createEditorTabType, EDITOR_TAB_TYPE_ID } from "./editor.tab.js"
import { createExplorerTabType, EXPLORER_TAB_TYPE_ID } from "./explorer.tab.js"
import { createOutputTabType, OUTPUT_TAB_TYPE_ID } from "./output.tab.js"
import {
  createTerminalExplorerTabType,
  TERMINAL_EXPLORER_TAB_TYPE_ID,
} from "./terminal-explorer.tab.js"
import { createTerminalTabType, TERMINAL_TAB_TYPE_ID } from "./terminal.tab.js"
import {
  createSearchTabType,
  createProblemsTabType,
  createReferencesTabType,
  createDefinitionsTabType,
  createTaskErrorsTabType,
  SEARCH_TAB_TYPE_ID,
  PROBLEMS_TAB_TYPE_ID,
  REFERENCES_TAB_TYPE_ID,
  DEFINITIONS_TAB_TYPE_ID,
  TASK_ERRORS_TAB_TYPE_ID,
} from "./list-tabs.js"

export {
  AGENT_CHAT_TAB_TYPE_ID,
  AGENT_EXPLORER_TAB_TYPE_ID,
  EDITOR_TAB_TYPE_ID,
  EXPLORER_TAB_TYPE_ID,
  OUTPUT_TAB_TYPE_ID,
  TERMINAL_EXPLORER_TAB_TYPE_ID,
  TERMINAL_TAB_TYPE_ID,
  SEARCH_TAB_TYPE_ID,
  PROBLEMS_TAB_TYPE_ID,
  REFERENCES_TAB_TYPE_ID,
  DEFINITIONS_TAB_TYPE_ID,
  TASK_ERRORS_TAB_TYPE_ID,
}
export type { TabContributorDeps } from "./deps.js"

export function registerBuiltinTabTypes(
  registry: TabTypeRegistry,
  deps: TabContributorDeps,
): void {
  registry.register(createAgentExplorerTabType(deps))
  registry.register(createAgentChatTabType(deps))
  registry.register(createEditorTabType(deps))
  registry.register(createExplorerTabType(deps))
  registry.register(createOutputTabType(deps))
  registry.register(createTerminalExplorerTabType(deps))
  registry.register(createTerminalTabType(deps))
  registry.register(createSearchTabType(deps))
  registry.register(createProblemsTabType(deps))
  registry.register(createReferencesTabType(deps))
  registry.register(createDefinitionsTabType(deps))
  registry.register(createTaskErrorsTabType(deps))
}
