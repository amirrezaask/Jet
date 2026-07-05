/** Registry of scroll-container refs for list-style panels (explorer, locationlist, ...).
 *  Removes reliance on `document.querySelector('[data-jet-list-panel="..."]')` in App.tsx.
 *  Items within the container are still queried live via `[data-jet-list-item]` — they may be
 *  virtualized and reactive, so a live subtree query is the right layer to look them up on. */
export type ListPanelKind = "explorer" | "locationlist"

const containers = new Map<ListPanelKind, HTMLElement>()

export function registerListPanel(kind: ListPanelKind, el: HTMLElement | null): () => void {
  if (!el) return () => {}
  containers.set(kind, el)
  return () => {
    if (containers.get(kind) === el) containers.delete(kind)
  }
}

export function getListPanel(kind: ListPanelKind): HTMLElement | null {
  return containers.get(kind) ?? null
}
