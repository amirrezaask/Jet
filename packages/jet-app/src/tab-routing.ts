import type { JetPanelTree, ListDocument, WorkspaceService } from "@jet/workspace"
import { normalizeAbsPath } from "@jet/workspace"
import { fileUriToPath } from "@jet/shared"
import {
  findPanelWithTab,
  isTerminalTabId,
  panelTabIds,
  terminalTabId,
} from "@jet/workspace"
import type { PanelId } from "@jet/shared"
import { resolveAuxiliaryPanel, resolveEditorPanel, getAllLeafPanels } from "./panel-routing.js"
import { agentChatTabId, AGENT_CHAT_TAB_TYPE_ID } from "./tabs/agent-chat.tab.js"
import { AGENT_EXPLORER_TAB_ID, AGENT_EXPLORER_TAB_TYPE_ID } from "./tabs/agent-explorer.tab.js"
import { TERMINAL_TAB_TYPE_ID, registerTerminalSession } from "./tabs/terminal.tab.js"
import { terminalCwdForTab } from "./tabs/terminal-session.js"

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
  launchCommand?: string
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

function rootUriKey(uri: string): string {
  if (!uri) return ""
  try {
    return normalizeAbsPath(fileUriToPath(uri))
  } catch {
    return uri
  }
}

export function listTerminalTabsForRoot(
  tree: JetPanelTree,
  rootUri: string,
): { panelId: PanelId; tabId: string }[] {
  const key = rootUriKey(rootUri)
  return listTerminalTabs(tree).filter(
    ({ tabId }) => rootUriKey(terminalCwdForTab(tabId)) === key,
  )
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
  registerTerminalSession(tabId, cwdRootUri, opts.launchCommand)
  return workspace.openOrFocusTab(tree, panel, {
    id: tabId,
    kind: TERMINAL_TAB_TYPE_ID,
    label,
  })
}

export function openAgentExplorerTab(
  workspace: WorkspaceService,
  tree: JetPanelTree,
  focused: PanelId | null,
): { panelId: PanelId; tabId: string } {
  const tab = { id: AGENT_EXPLORER_TAB_ID, kind: AGENT_EXPLORER_TAB_TYPE_ID, label: "Agents" }
  const existingPanel = findPanelWithTab(tree, AGENT_EXPLORER_TAB_ID)
  if (existingPanel) {
    return workspace.openOrFocusTab(tree, existingPanel, tab)
  }
  const panel = resolveAuxiliaryPanel(tree, focused)
  return workspace.openOrFocusTab(tree, panel, tab)
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
