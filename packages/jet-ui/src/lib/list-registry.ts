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
