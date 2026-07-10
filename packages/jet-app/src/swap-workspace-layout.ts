import type { PanelId } from "@jet/shared"
import type { JetPanelTree } from "@jet/workspace"
import {
  WorkspaceLayoutStore,
  defaultWorkspaceLayout,
} from "./workspace-layout-store.js"

export function swapWorkspaceLayout(opts: {
  store: WorkspaceLayoutStore
  outgoingRootUri: string | null
  incomingRootUri: string
  currentTree: JetPanelTree
  editorPanel: PanelId | null
}): { tree: JetPanelTree; editorPanel: PanelId | null } {
  const { store, outgoingRootUri, incomingRootUri, currentTree, editorPanel } = opts

  if (outgoingRootUri) {
    store.save(outgoingRootUri, currentTree, editorPanel)
  }

  const loaded = store.load(incomingRootUri)
  if (loaded) return loaded

  return defaultWorkspaceLayout()
}
