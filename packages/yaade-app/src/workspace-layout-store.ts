import type { PanelId, PanelView } from "@yaade/shared"
import type { PanelTreeSnapshot } from "@yaade/panels"
import { fileUriToPath } from "@yaade/shared"
import { YaadePanelTree, normalizeAbsPath } from "@yaade/workspace"
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

  save(rootUri: string, tree: YaadePanelTree, editorPanel: PanelId | null): void {
    this.byRootUri.set(layoutKey(rootUri), {
      tree: tree.toJSON(),
      editorPanelId: editorPanel?.id ?? null,
    })
  }

  load(rootUri: string): { tree: YaadePanelTree; editorPanel: PanelId | null } | null {
    const snapshot = this.byRootUri.get(layoutKey(rootUri))
    if (!snapshot) return null
    const tree = YaadePanelTree.jetFromJSON(snapshot.tree)
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

export function defaultWorkspaceLayout(): { tree: YaadePanelTree; editorPanel: PanelId } {
  return YaadePanelTree.editorOnlyLayout()
}
