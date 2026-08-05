import type { Edge, PanelId } from "@yaade/shared"
import type { YaadePanelTree } from "@yaade/workspace"
import { listPaneLeaves, placePtyInTree } from "./layout.js"

export type AllocatedTerminalPane = {
  ptyTabId: string
  label: string
  rootUri: string
  launchCommand?: string
  launchArgs?: string[]
}

export type AllocatedGitPane = {
  tabId: string
  rootUri: string
}

/** Pure: place an already-registered terminal tab into the window tree. */
export function placeTerminalPane(
  live: {
    id: string
    title: string
    tree: YaadePanelTree
    focusedPaneId: PanelId | null
    zoomedPaneId: string | null
  },
  pane: AllocatedTerminalPane,
  edge: Edge = "right",
  focusPanel: PanelId | null = live.focusedPaneId,
): typeof live {
  const tree = live.tree.clone()
  const panelId = placePtyInTree(tree, pane.ptyTabId, focusPanel, edge)
  const sole = listPaneLeaves(tree).length === 1
  return {
    ...live,
    tree,
    focusedPaneId: panelId,
    zoomedPaneId: null,
    title: sole ? pane.label : live.title,
  }
}

/** Pure: place an already-registered git tab into the window tree. */
export function placeGitPane(
  live: {
    id: string
    title: string
    tree: YaadePanelTree
    focusedPaneId: PanelId | null
    zoomedPaneId: string | null
  },
  pane: AllocatedGitPane,
  edge: Edge = "right",
  focusPanel: PanelId | null = live.focusedPaneId,
): typeof live {
  const tree = live.tree.clone()
  const panelId = placePtyInTree(tree, pane.tabId, focusPanel, edge)
  return {
    ...live,
    tree,
    focusedPaneId: panelId,
    zoomedPaneId: null,
  }
}
