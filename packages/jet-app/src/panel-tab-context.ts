import type { JetPanelTree } from "@jet/workspace"
import { panelTabIds } from "@jet/workspace"
import type { PanelId } from "@jet/shared"

export function activeTabKind(
  tree: JetPanelTree,
  panel: PanelId | null,
  tabRegistry: { kindFor(id: string): string | undefined },
): string | undefined {
  if (!panel) return undefined
  const view = tree.getView(panel)
  if (view?.kind !== "tabs") return view?.kind
  return tabRegistry.kindFor(view.activeTabId) ?? "tabs"
}

export function getActiveTabId(tree: JetPanelTree, panel: PanelId | null): string | null {
  if (!panel) return null
  const view = tree.getView(panel)
  if (view?.kind !== "tabs") return null
  return view.activeTabId
}

export function getActiveEditorFileUri(tree: JetPanelTree, panel: PanelId | null): string | null {
  if (!panel) return null
  const view = tree.getView(panel)
  if (view?.kind !== "tabs") return null
  const active = view.activeTabId
  if (active.startsWith("file:") || active.startsWith("untitled:")) return active
  const editorTab = panelTabIds(view).find(id => id.startsWith("file:") || id.startsWith("untitled:"))
  return editorTab ?? null
}
