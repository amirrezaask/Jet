import type { TabId } from "@jet/shared"

const pending = new Map<number, string>()

export function setPendingInitialContent(tabId: TabId, text: string): void {
  pending.set(tabId.id, text)
}

export function consumePendingInitialContent(tabId: TabId): string | undefined {
  const content = pending.get(tabId.id)
  if (content != null) pending.delete(tabId.id)
  return content
}
