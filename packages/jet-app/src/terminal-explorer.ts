import type { JetPanelTree, WorkspaceService } from "@jet/workspace"
import type { PanelId } from "@jet/shared"
import { listTerminalTabs } from "./tab-routing.js"
import { terminalCwdForTab, terminalSessionForTab } from "./tabs/terminal-session.js"

export type TerminalExplorerEntry = {
  tabId: string
  panelId: PanelId
  label: string
  cwdRootUri: string
  status: "starting" | "running" | "exited" | "failed"
  exitCode?: number
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
  treeOrTrees: JetPanelTree | JetPanelTree[],
  workspace: WorkspaceService,
): TerminalExplorerGroup[] {
  const trees = Array.isArray(treeOrTrees) ? treeOrTrees : [treeOrTrees]
  const seenTabs = new Set<string>()
  const terminals = trees.flatMap(tree =>
    listTerminalTabs(tree).filter(({ tabId }) => {
      if (seenTabs.has(tabId)) return false
      seenTabs.add(tabId)
      return true
    }),
  )
  const byRootUri = new Map<string, TerminalExplorerEntry[]>()
  const orphans: TerminalExplorerEntry[] = []

  const folderByRootUri = new Map(
    workspace.folders.map(folder => [folder.root.uri, folder]),
  )

  for (const { panelId, tabId } of terminals) {
    const cwdRootUri = terminalCwdForTab(tabId) || workspace.root?.uri || ""
    const label = workspace.tabRegistry.get(tabId)?.label ?? "Terminal"
    const session = terminalSessionForTab(tabId)
    const entry: TerminalExplorerEntry = {
      tabId,
      panelId,
      label,
      cwdRootUri,
      status: session?.status ?? "starting",
      exitCode: session?.exitCode,
    }

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
