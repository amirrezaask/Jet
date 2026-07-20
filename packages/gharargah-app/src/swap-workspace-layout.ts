import type { PanelId } from "@gharargah/shared"
import type { GharargahPanelTree } from "@gharargah/workspace"
import {
  WorkspaceLayoutStore,
  defaultWorkspaceLayout,
} from "./workspace-layout-store.js"

export function swapWorkspaceLayout(opts: {
  store: WorkspaceLayoutStore
  outgoingRootUri: string | null
  incomingRootUri: string
  currentTree: GharargahPanelTree
  editorPanel: PanelId | null
}): { tree: GharargahPanelTree; editorPanel: PanelId | null } {
  const { store, outgoingRootUri, incomingRootUri, currentTree, editorPanel } = opts

  if (outgoingRootUri) {
    store.save(outgoingRootUri, currentTree, editorPanel)
  }

  const loaded = store.load(incomingRootUri)
  if (loaded) return loaded

  return defaultWorkspaceLayout()
}
