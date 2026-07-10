import type { PanelId, PanelView } from "@jet/shared"
import type { PanelTreeSnapshot } from "@jet/panels"
import { fileUriToPath } from "@jet/shared"
import { JetPanelTree, normalizeAbsPath } from "@jet/workspace"
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

  save(rootUri: string, tree: JetPanelTree, editorPanel: PanelId | null): void {
    this.byRootUri.set(layoutKey(rootUri), {
      tree: tree.toJSON(),
      editorPanelId: editorPanel?.id ?? null,
    })
  }

  load(rootUri: string): { tree: JetPanelTree; editorPanel: PanelId | null } | null {
    const snapshot = this.byRootUri.get(layoutKey(rootUri))
    if (!snapshot) return null
    const tree = JetPanelTree.jetFromJSON(snapshot.tree)
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

export function defaultWorkspaceLayout(): { tree: JetPanelTree; editorPanel: PanelId } {
  return JetPanelTree.editorOnlyLayout()
}
