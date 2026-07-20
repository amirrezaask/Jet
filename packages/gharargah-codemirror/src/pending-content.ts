import type { PanelId } from "@gharargah/shared"

const pending = new Map<number, string>()

export function setPendingInitialContent(panelId: PanelId, text: string): void {
  pending.set(panelId.id, text)
}

export function consumePendingInitialContent(panelId: PanelId): string | undefined {
  const content = pending.get(panelId.id)
  if (content != null) pending.delete(panelId.id)
  return content
}
