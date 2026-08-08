import type { Edge, PanelId } from "@yaade/shared"
import type { YaadePanelTree } from "@yaade/workspace"
import {
  listPaneLeaves,
  placeMuxLeafInTree,
  placeOrPushEditorTab,
} from "./layout.js"
import type { MuxToolKind } from "./tool-pane.js"

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

export type AllocatedEditorPane = {
  tabId: string
  uri: string
  line?: number
  label: string
}

export type AllocatedToolPane = {
  tabId: string
  kind: MuxToolKind
  label: string
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
  const panelId = placeMuxLeafInTree(tree, pane.ptyTabId, focusPanel, edge)
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
  const panelId = placeMuxLeafInTree(tree, pane.tabId, focusPanel, edge)
  return {
    ...live,
    tree,
    focusedPaneId: panelId,
    zoomedPaneId: null,
  }
}

/** Pure: place or focus a singleton persistent tool in the tiled mux tree. */
export function placeToolPane(
  live: {
    id: string
    title: string
    tree: YaadePanelTree
    focusedPaneId: PanelId | null
    zoomedPaneId: string | null
  },
  pane: AllocatedToolPane,
  edge: Edge = "right",
  focusPanel: PanelId | null = live.focusedPaneId,
): typeof live {
  const tree = live.tree.clone()
  const panelId = placeMuxLeafInTree(tree, pane.tabId, focusPanel, edge)
  return {
    ...live,
    tree,
    focusedPaneId: panelId,
    zoomedPaneId: null,
  }
}

/**
 * Pure: place/activate/push an editor buffer tab.
 * By default reuses an existing tab or pushes into the focused editor group.
 * Pass `forceNewGroup` to always open a new editor pane (split when needed).
 */
export function placeEditorPane(
  live: {
    id: string
    title: string
    tree: YaadePanelTree
    focusedPaneId: PanelId | null
    zoomedPaneId: string | null
  },
  pane: AllocatedEditorPane,
  edge: Edge = "right",
  focusPanel: PanelId | null = live.focusedPaneId,
  options?: { forceNewGroup?: boolean },
): typeof live {
  const tree = live.tree.clone()
  const panelId = placeOrPushEditorTab(
    tree,
    pane.tabId,
    focusPanel,
    edge,
    options,
  )
  return {
    ...live,
    tree,
    focusedPaneId: panelId,
    zoomedPaneId: null,
  }
}
