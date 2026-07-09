import { focusFirstListItem } from "../lib/list-registry.js"
import { TERMINAL_EXPLORER_LIST_ID } from "../tabs/TerminalExplorerTab.js"

/** Focus the terminal explorer panel wherever it currently lives in the panel tree. */
export function focusTerminalExplorerPanel(): void {
  focusFirstListItem(TERMINAL_EXPLORER_LIST_ID)
}
