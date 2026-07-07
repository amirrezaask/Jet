import type { JetPanelTree, ListDocument, WorkspaceService } from "@jet/workspace"
import {
  EXPLORER_TAB_ID,
  findPanelWithTab,
  isTerminalTabId,
  panelTabIds,
  terminalTabId,
} from "@jet/workspace"
import type { PanelId } from "@jet/shared"
import { resolveAuxiliaryPanel, resolveEditorPanel, getAllLeafPanels } from "./panel-routing.js"
import { agentChatTabId, AGENT_CHAT_TAB_TYPE_ID } from "./tabs/agent-chat.tab.js"
import { AGENT_EXPLORER_TAB_ID, AGENT_EXPLORER_TAB_TYPE_ID } from "./tabs/agent-explorer.tab.js"
import {
  TERMINAL_EXPLORER_TAB_ID,
  TERMINAL_EXPLORER_TAB_TYPE_ID,
} from "./tabs/terminal-explorer.tab.js"
import { TERMINAL_TAB_TYPE_ID, registerTerminalSession } from "./tabs/terminal.tab.js"

const SIDEBAR_EXPLORER_TAB_IDS = [
  EXPLORER_TAB_ID,
  AGENT_EXPLORER_TAB_ID,
  TERMINAL_EXPLORER_TAB_ID,
] as const

export function findPanelWithAnySidebarExplorerTab(tree: JetPanelTree): PanelId | null {
  for (const tabId of SIDEBAR_EXPLORER_TAB_IDS) {
    const panel = findPanelWithTab(tree, tabId)
    if (panel) return panel
  }
  return null
}

export function openTabInAuxiliaryPanel(
  workspace: WorkspaceService,
  tree: JetPanelTree,
  focused: PanelId | null,
  doc: ListDocument,
): { panelId: PanelId; tabId: string } {
  const exclude = focused ? new Set([focused.id]) : undefined
  const panel = resolveAuxiliaryPanel(tree, focused, { excludePanelIds: exclude })
  return workspace.openOrFocusTab(tree, panel, {
    id: doc.id,
    kind: doc.feed,
    label: doc.title,
  }, doc)
}

export function openSearchTab(
  workspace: WorkspaceService,
  tree: JetPanelTree,
  focused: PanelId | null,
): { panelId: PanelId; tabId: string } {
  const doc = workspace.createSearchList()
  return openTabInAuxiliaryPanel(workspace, tree, focused, doc)
}

export function openProblemsTab(
  workspace: WorkspaceService,
  tree: JetPanelTree,
  focused: PanelId | null,
): { panelId: PanelId; tabId: string } {
  const doc = workspace.ensureProblemsList()
  const exclude = focused ? new Set([focused.id]) : undefined
  const panel = resolveAuxiliaryPanel(tree, focused, { excludePanelIds: exclude })
  return workspace.openOrFocusTab(tree, panel, {
    id: doc.id,
    kind: "problems",
    label: doc.title,
  }, doc)
}

export function openOutputTab(
  workspace: WorkspaceService,
  tree: JetPanelTree,
  panelId: PanelId,
): { panelId: PanelId; tabId: string } {
  const tab = workspace.outputTab()
  return workspace.openOrFocusTab(tree, panelId, tab)
}

export type OpenTerminalTabOpts = {
  sessionKey?: string
  label?: string
  cwdRootUri?: string
}

export function listTerminalTabs(
  tree: JetPanelTree,
): { panelId: PanelId; tabId: string }[] {
  const result: { panelId: PanelId; tabId: string }[] = []
  for (const panel of getAllLeafPanels(tree)) {
    const view = tree.getView(panel)
    if (view?.kind !== "tabs") continue
    for (const tabId of panelTabIds(view)) {
      if (isTerminalTabId(tabId)) result.push({ panelId: panel, tabId })
    }
  }
  return result
}

export function isActiveTerminalTab(tree: JetPanelTree, focused: PanelId | null): boolean {
  if (!focused) return false
  const view = tree.getView(focused)
  if (view?.kind !== "tabs") return false
  return isTerminalTabId(view.activeTabId)
}

export function openTerminalTab(
  workspace: WorkspaceService,
  tree: JetPanelTree,
  focused: PanelId | null,
  opts: OpenTerminalTabOpts = {},
): { panelId: PanelId; tabId: string } {
  const sessionKey = opts.sessionKey ?? `session-${Date.now()}`
  const tabId = terminalTabId(sessionKey)
  const label = opts.label ?? "Terminal"
  const cwdRootUri = opts.cwdRootUri ?? workspace.root?.uri ?? ""
  const panel = resolveAuxiliaryPanel(tree, focused, { splitEdge: "bottom" })
  registerTerminalSession(tabId, cwdRootUri)
  return workspace.openOrFocusTab(tree, panel, {
    id: tabId,
    kind: TERMINAL_TAB_TYPE_ID,
    label,
  })
}

export function openExplorerTab(
  workspace: WorkspaceService,
  tree: JetPanelTree,
  focused: PanelId | null,
): { panelId: PanelId; tabId: string } {
  const tab = workspace.explorerTab()
  const existingPanel = findPanelWithAnySidebarExplorerTab(tree)
  if (existingPanel) {
    return workspace.openOrFocusTab(tree, existingPanel, tab)
  }

  const editorPanel = resolveEditorPanel(tree, null, focused)
  if (!editorPanel) {
    const leaf = getAllLeafPanels(tree)[0]
    return workspace.openOrFocusTab(tree, leaf ?? tree.allocPanelId(), tab)
  }

  const sidebar = tree.splitAtEdge(editorPanel, "left")
  return workspace.openOrFocusTab(tree, sidebar, tab)
}

export function openAgentExplorerTab(
  workspace: WorkspaceService,
  tree: JetPanelTree,
  focused: PanelId | null,
): { panelId: PanelId; tabId: string } {
  const tab = { id: AGENT_EXPLORER_TAB_ID, kind: AGENT_EXPLORER_TAB_TYPE_ID, label: "Agents" }
  const existingPanel = findPanelWithAnySidebarExplorerTab(tree)
  if (existingPanel) {
    return workspace.openOrFocusTab(tree, existingPanel, tab)
  }

  const editorPanel = resolveEditorPanel(tree, null, focused)
  if (!editorPanel) {
    const leaf = getAllLeafPanels(tree)[0]
    return workspace.openOrFocusTab(tree, leaf ?? tree.allocPanelId(), tab)
  }

  const sidebar = tree.splitAtEdge(editorPanel, "left")
  return workspace.openOrFocusTab(tree, sidebar, tab)
}

export function openTerminalExplorerTab(
  workspace: WorkspaceService,
  tree: JetPanelTree,
  focused: PanelId | null,
): { panelId: PanelId; tabId: string } {
  const tab = {
    id: TERMINAL_EXPLORER_TAB_ID,
    kind: TERMINAL_EXPLORER_TAB_TYPE_ID,
    label: "Terminals",
  }
  const existingPanel = findPanelWithAnySidebarExplorerTab(tree)
  if (existingPanel) {
    return workspace.openOrFocusTab(tree, existingPanel, tab)
  }

  const editorPanel = resolveEditorPanel(tree, null, focused)
  if (!editorPanel) {
    const leaf = getAllLeafPanels(tree)[0]
    return workspace.openOrFocusTab(tree, leaf ?? tree.allocPanelId(), tab)
  }

  const sidebar = tree.splitAtEdge(editorPanel, "left")
  return workspace.openOrFocusTab(tree, sidebar, tab)
}

export function openAgentChatTab(
  workspace: WorkspaceService,
  tree: JetPanelTree,
  focused: PanelId | null,
  rootUri: string,
  threadId: string,
  title: string,
): { panelId: PanelId; tabId: string } {
  const tabId = agentChatTabId(rootUri, threadId)
  const panel = resolveEditorPanel(tree, null, focused) ?? getAllLeafPanels(tree)[0] ?? tree.allocPanelId()
  return workspace.openOrFocusTab(tree, panel, {
    id: tabId,
    kind: AGENT_CHAT_TAB_TYPE_ID,
    label: title,
  })
}
