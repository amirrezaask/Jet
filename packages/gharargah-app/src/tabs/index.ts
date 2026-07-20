import type { TabTypeRegistry } from "@gharargah/ui"
import type { TabContributorDeps } from "./deps.js"
import { createTerminalTabType, TERMINAL_TAB_TYPE_ID } from "./terminal.tab.js"

export { TERMINAL_TAB_TYPE_ID }
export type { TabContributorDeps } from "./deps.js"

export function registerBuiltinTabTypes(
  registry: TabTypeRegistry,
  deps: TabContributorDeps,
): void {
  registry.register(createTerminalTabType(deps))
}
