import { getListPanel } from "../lib/list-registry.js"
import { TERMINAL_EXPLORER_LIST_ID } from "../tabs/TerminalExplorerTab.js"

/** Focus the terminal explorer panel wherever it currently lives in the panel tree. */
export function focusTerminalExplorerPanel(): void {
  const el = getListPanel(TERMINAL_EXPLORER_LIST_ID)
  if (!el) return
  const first = el.querySelector<HTMLElement>("[data-jet-list-item]")
  ;(first ?? el).focus()
}
