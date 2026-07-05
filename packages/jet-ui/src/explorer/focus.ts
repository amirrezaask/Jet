import { getListPanel } from "../lib/list-registry.js"

/** Focus the explorer panel wherever it currently lives in the panel tree. */
export function focusExplorerPanel(): void {
  const el = getListPanel("explorer")
  if (!el) return
  const first = el.querySelector<HTMLElement>("[data-jet-list-item]")
  ;(first ?? el).focus()
}
