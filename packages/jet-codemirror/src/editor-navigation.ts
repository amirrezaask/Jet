import type { PanelId } from "@jet/shared"

const pending = new Map<number, { line: number; column: number }>()

export function setPendingEditorNavigation(panelId: PanelId, line: number, column: number): void {
  pending.set(panelId.id, { line, column })
}

export function consumePendingEditorNavigation(
  panelId: PanelId,
): { line: number; column: number } | undefined {
  const nav = pending.get(panelId.id)
  if (nav) pending.delete(panelId.id)
  return nav
}

/** @deprecated use PanelId */
export function setPendingEditorNavigationTab(tabId: { id: number }, line: number, column: number): void {
  setPendingEditorNavigation({ id: tabId.id }, line, column)
}
