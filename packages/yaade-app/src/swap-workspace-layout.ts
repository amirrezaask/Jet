import type { PanelId } from "@yaade/shared"
import type { YaadePanelTree } from "@yaade/workspace"
import {
  WorkspaceLayoutStore,
  defaultWorkspaceLayout,
} from "./workspace-layout-store.js"

export function swapWorkspaceLayout(opts: {
  store: WorkspaceLayoutStore
  outgoingRootUri: string | null
  incomingRootUri: string
  currentTree: YaadePanelTree
  editorPanel: PanelId | null
}): { tree: YaadePanelTree; editorPanel: PanelId | null } {
  const { store, outgoingRootUri, incomingRootUri, currentTree, editorPanel } = opts

  if (outgoingRootUri) {
    store.save(outgoingRootUri, currentTree, editorPanel)
  }

  const loaded = store.load(incomingRootUri)
  if (loaded) return loaded

  return defaultWorkspaceLayout()
}
