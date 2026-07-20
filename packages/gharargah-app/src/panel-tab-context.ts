import type { GharargahPanelTree } from "@gharargah/workspace"
import type { KnownTabKind } from "@gharargah/workspace"
import { panelTabIds } from "@gharargah/workspace"
import type { FileUri, PanelId } from "@gharargah/shared"
import { isFileUri, isUntitledUri } from "@gharargah/shared"

export type ActiveTabKind = KnownTabKind | "empty" | "tabs"

export function activeTabKind(
  tree: GharargahPanelTree,
  panel: PanelId | null,
  tabRegistry: { kindFor(id: string): KnownTabKind | undefined },
): ActiveTabKind | undefined {
  if (!panel) return undefined
  const view = tree.getView(panel)
  if (view?.kind !== "tabs") return view?.kind
  return tabRegistry.kindFor(view.activeTabId) ?? "tabs"
}

export function getActiveTabId(tree: GharargahPanelTree, panel: PanelId | null): string | null {
  if (!panel) return null
  const view = tree.getView(panel)
  if (view?.kind !== "tabs") return null
  return view.activeTabId
}

export function getActiveEditorFileUri(tree: GharargahPanelTree, panel: PanelId | null): FileUri | null {
  if (!panel) return null
  const view = tree.getView(panel)
  if (view?.kind !== "tabs") return null
  const active = view.activeTabId
  if (isFileUri(active)) return active
  if (isUntitledUri(active)) return null
  const editorTab = panelTabIds(view).find(id => isFileUri(id))
  return editorTab ?? null
}
