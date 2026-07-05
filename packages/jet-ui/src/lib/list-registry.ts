/** Registry of scroll-container refs for list-style panels keyed by listId. */
const containers = new Map<string, HTMLElement>()

export function registerListPanel(listId: string, el: HTMLElement | null): () => void {
  if (!el) return () => {}
  containers.set(listId, el)
  return () => {
    if (containers.get(listId) === el) containers.delete(listId)
  }
}

export function getListPanel(listId: string): HTMLElement | null {
  return containers.get(listId) ?? null
}

/** Explorer keeps a fixed kind key for keyboard nav. */
const EXPLORER_KEY = "__explorer__"

export function registerExplorerPanel(el: HTMLElement | null): () => void {
  if (!el) return () => {}
  containers.set(EXPLORER_KEY, el)
  return () => {
    if (containers.get(EXPLORER_KEY) === el) containers.delete(EXPLORER_KEY)
  }
}

export function getExplorerPanel(): HTMLElement | null {
  return containers.get(EXPLORER_KEY) ?? null
}
