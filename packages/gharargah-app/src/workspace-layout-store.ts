import type { PanelId, PanelView } from "@gharargah/shared"
import type { PanelTreeSnapshot } from "@gharargah/panels"
import { fileUriToPath } from "@gharargah/shared"
import { GharargahPanelTree, normalizeAbsPath } from "@gharargah/workspace"
import { getAllLeafPanels } from "./panel-routing.js"

export type WorkspaceLayoutSnapshot = {
  tree: PanelTreeSnapshot<PanelView>
  editorPanelId: number | null
}

function layoutKey(rootUri: string): string {
  try {
    return normalizeAbsPath(fileUriToPath(rootUri))
  } catch {
    return rootUri
  }
}

export class WorkspaceLayoutStore {
  private byRootUri = new Map<string, WorkspaceLayoutSnapshot>()

  save(rootUri: string, tree: GharargahPanelTree, editorPanel: PanelId | null): void {
    this.byRootUri.set(layoutKey(rootUri), {
      tree: tree.toJSON(),
      editorPanelId: editorPanel?.id ?? null,
    })
  }

  load(rootUri: string): { tree: GharargahPanelTree; editorPanel: PanelId | null } | null {
    const snapshot = this.byRootUri.get(layoutKey(rootUri))
    if (!snapshot) return null
    const tree = GharargahPanelTree.jetFromJSON(snapshot.tree)
    const leafIds = getAllLeafPanels(tree).map(p => p.id)
    const editorPanel =
      snapshot.editorPanelId != null && leafIds.includes(snapshot.editorPanelId)
        ? ({ id: snapshot.editorPanelId } as PanelId)
        : null
    return { tree, editorPanel }
  }

  delete(rootUri: string): void {
    this.byRootUri.delete(layoutKey(rootUri))
  }
}

export function defaultWorkspaceLayout(): { tree: GharargahPanelTree; editorPanel: PanelId } {
  return GharargahPanelTree.editorOnlyLayout()
}
