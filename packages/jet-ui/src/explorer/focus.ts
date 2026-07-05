import { getListPanel } from "../lib/list-registry.js"

export const EXPLORER_LIST_ID = "jet:explorer"

/** Focus the explorer panel wherever it currently lives in the panel tree. */
export function focusExplorerPanel(): void {
  const el = getListPanel(EXPLORER_LIST_ID)
  if (!el) return
  const first = el.querySelector<HTMLElement>("[data-jet-list-item]")
  ;(first ?? el).focus()
}
