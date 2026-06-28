import type { TabId } from "@jet/shared"

const pending = new Map<number, { line: number; column: number }>()

export function setPendingEditorNavigation(tabId: TabId, line: number, column: number): void {
  pending.set(tabId.id, { line, column })
}

export function consumePendingEditorNavigation(tabId: TabId): { line: number; column: number } | undefined {
  const nav = pending.get(tabId.id)
  if (nav) pending.delete(tabId.id)
  return nav
}
