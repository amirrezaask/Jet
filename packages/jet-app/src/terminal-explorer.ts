import type { JetPanelTree, WorkspaceService } from "@jet/workspace"
import type { PanelId } from "@jet/shared"
import { listTerminalTabs } from "./tab-routing.js"
import { terminalCwdForTab } from "./tabs/terminal-session.js"

export type TerminalExplorerEntry = {
  tabId: string
  panelId: PanelId
  label: string
  cwdRootUri: string
}

export type TerminalExplorerGroup = {
  id: string
  name: string
  path: string
  rootUri: string
  terminals: TerminalExplorerEntry[]
}

const OTHER_GROUP_ID = "jet:terminal-explorer:other"

export function buildTerminalExplorerGroups(
  tree: JetPanelTree,
  workspace: WorkspaceService,
): TerminalExplorerGroup[] {
  const terminals = listTerminalTabs(tree)
  const byRootUri = new Map<string, TerminalExplorerEntry[]>()
  const orphans: TerminalExplorerEntry[] = []

  const folderByRootUri = new Map(
    workspace.folders.map(folder => [folder.root.uri, folder]),
  )

  for (const { panelId, tabId } of terminals) {
    const cwdRootUri = terminalCwdForTab(tabId) || workspace.root?.uri || ""
    const label = workspace.tabRegistry.get(tabId)?.label ?? "Terminal"
    const entry: TerminalExplorerEntry = { tabId, panelId, label, cwdRootUri }

    if (folderByRootUri.has(cwdRootUri)) {
      const list = byRootUri.get(cwdRootUri) ?? []
      list.push(entry)
      byRootUri.set(cwdRootUri, list)
    } else {
      orphans.push(entry)
    }
  }

  const groups: TerminalExplorerGroup[] = workspace.folders.map(folder => ({
    id: folder.id,
    name: folder.root.name,
    path: folder.root.path,
    rootUri: folder.root.uri,
    terminals: byRootUri.get(folder.root.uri) ?? [],
  }))

  if (orphans.length > 0) {
    groups.push({
      id: OTHER_GROUP_ID,
      name: "Other",
      path: "",
      rootUri: "",
      terminals: orphans,
    })
  }

  return groups
}

export function nextTerminalLabel(tree: JetPanelTree): string {
  const count = listTerminalTabs(tree).length
  return count === 0 ? "Terminal" : `Terminal ${count + 1}`
}
