import type { TabTypeRegistry } from "@gharargah/ui"
import type { TabContributorDeps } from "./deps.js"
import { createEditorTabType, EDITOR_TAB_TYPE_ID } from "./editor.tab.js"
import { createTerminalTabType, TERMINAL_TAB_TYPE_ID } from "./terminal.tab.js"

export { EDITOR_TAB_TYPE_ID, TERMINAL_TAB_TYPE_ID }
export type { TabContributorDeps } from "./deps.js"

export function registerBuiltinTabTypes(
  registry: TabTypeRegistry,
  deps: TabContributorDeps,
): void {
  registry.register(createEditorTabType(deps))
  registry.register(createTerminalTabType(deps))
}
