import type { YaadePanelTree } from "@yaade/workspace"
import type { KnownTabKind } from "@yaade/workspace"
import { panelTabIds } from "@yaade/workspace"
import type { PanelId } from "@yaade/shared"
import { isFileUri, isUntitledUri } from "@yaade/shared"

export type ActiveTabKind = KnownTabKind | "empty" | "tabs"

export function activeTabKind(
  tree: YaadePanelTree,
  panel: PanelId | null,
  tabRegistry: { kindFor(id: string): KnownTabKind | undefined },
): ActiveTabKind | undefined {
  if (!panel) return undefined
  const view = tree.getView(panel)
  if (view?.kind !== "tabs") return view?.kind
  return tabRegistry.kindFor(view.activeTabId) ?? "tabs"
}

export function getActiveTabId(tree: YaadePanelTree, panel: PanelId | null): string | null {
  if (!panel) return null
  const view = tree.getView(panel)
  if (view?.kind !== "tabs") return null
  return view.activeTabId
}

export function getActiveEditorFileUri(tree: YaadePanelTree, panel: PanelId | null): string | null {
  if (!panel) return null
  const view = tree.getView(panel)
  if (view?.kind !== "tabs") return null
  const active = view.activeTabId
  if (isFileUri(active) || isUntitledUri(active)) return active
  const editorTab = panelTabIds(view).find(id => isFileUri(id) || isUntitledUri(id))
  return editorTab ?? null
}
