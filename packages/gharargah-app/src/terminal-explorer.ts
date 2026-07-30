import type { GharargahPanelTree, WorkspaceService } from "@gharargah/workspace"
import type { PanelId } from "@gharargah/shared"
import { fileUriToPath } from "@gharargah/shared"
import { detectSessionProvider } from "@gharargah/ui"
import { listTerminalTabs } from "./tab-routing.js"
import { terminalCwdForTab, terminalSessionForTab } from "./tabs/terminal-session.js"

export type TerminalExplorerEntry = {
  tabId: string
  panelId: PanelId
  label: string
  cwdRootUri: string
  status: "starting" | "running" | "exited" | "failed"
  exitCode?: number
  launchCommand?: string
  agentId?: "codex" | "claude" | "opencode" | "cursor" | "grok"
  doneAt?: string
}

export type TerminalExplorerGroup = {
  id: string
  name: string
  path: string
  rootUri: string
  terminals: TerminalExplorerEntry[]
}

const OTHER_GROUP_ID = "gharargah:terminal-explorer:other"

function normalizeAbsPath(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, "")
  return (trimmed || p)
    .replace(/\\/g, "/")
    .replace(/^\/private(?=\/(?:var|tmp)(?:\/|$))/, "")
}

function resolveFolderForCwd(
  cwdRootUri: string,
  workspace: WorkspaceService,
): { root: { uri: string; path: string; name: string }; id: string } | null {
  const exact = workspace.folders.find(folder => folder.root.uri === cwdRootUri)
  if (exact) return exact
  const cwdPath = normalizeAbsPath(fileUriToPath(cwdRootUri))
  return (
    workspace.folders.find(
      folder => normalizeAbsPath(folder.root.path) === cwdPath,
    ) ?? null
  )
}

export function buildTerminalExplorerGroups(
  treeOrTrees: GharargahPanelTree | GharargahPanelTree[],
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

  for (const { panelId, tabId } of terminals) {
    const session = terminalSessionForTab(tabId)
    const rawCwd = terminalCwdForTab(tabId) || workspace.root?.uri || ""
    const folder = resolveFolderForCwd(rawCwd, workspace)
    const cwdRootUri = folder?.root.uri ?? rawCwd
    const label = workspace.tabRegistry.get(tabId)?.label ?? "Terminal"
    const entry: TerminalExplorerEntry = {
      tabId,
      panelId,
      label,
      cwdRootUri,
      status: session?.status ?? "starting",
      exitCode: session?.exitCode,
      launchCommand: session?.launchCommand,
      agentId:
        (session?.agentId as TerminalExplorerEntry["agentId"] | undefined) ??
        detectSessionProvider(session?.launchCommand),
      doneAt: session?.doneAt,
    }

    if (folder) {
      const list = byRootUri.get(folder.root.uri) ?? []
      list.push(entry)
      byRootUri.set(folder.root.uri, list)
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

export function nextTerminalLabel(tree: GharargahPanelTree): string {
  const count = listTerminalTabs(tree).length
  return count === 0 ? "Terminal" : `Terminal ${count + 1}`
}

/** 1-based terminal index within a workspace root (terminal explorer order). */
export function terminalAtIndex(
  groups: TerminalExplorerGroup[],
  rootUri: string,
  index: number,
): TerminalExplorerEntry | null {
  if (index < 1) return null
  const group = groups.find(candidate => candidate.rootUri === rootUri)
  return group?.terminals[index - 1] ?? null
}
