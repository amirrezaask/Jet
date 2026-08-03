import type { PanelId } from "@yaade/shared"
import { fileUriToPath } from "@yaade/shared"
import { detectSessionProvider, type HomeProjectGroup } from "@yaade/ui"
import type { YaadePanelTree, WorkspaceService } from "@yaade/workspace"
import { findPanelWithTab } from "@yaade/workspace"
import { listTerminalSessions } from "./tabs/terminal-session.js"

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

/**
 * Sidebar roster from the session store (not the open-layout panel tree).
 * `panelId` is filled when the session is currently open in `tree`.
 */
export function buildSessionSidebarGroups(
  tree: YaadePanelTree,
  workspace: WorkspaceService,
): HomeProjectGroup[] {
  const byRootUri = new Map<
    string,
    HomeProjectGroup["terminals"]
  >()
  const orphans: HomeProjectGroup["terminals"] = []

  for (const session of listTerminalSessions()) {
    const folder = resolveFolderForCwd(session.cwdRootUri, workspace)
    const cwdRootUri = folder?.root.uri ?? session.cwdRootUri
    const panelId: PanelId | null = findPanelWithTab(tree, session.tabId)
    const label =
      session.customLabel ??
      session.agentTitle ??
      workspace.tabRegistry.get(session.tabId)?.label ??
      "Terminal"
    const entry = {
      tabId: session.tabId,
      panelId,
      label,
      status: session.status,
      exitCode: session.exitCode,
      launchCommand: session.launchCommand,
      agentId:
        (session.agentId as HomeProjectGroup["terminals"][number]["agentId"]) ??
        detectSessionProvider(session.launchCommand),
      archivedAt: session.archivedAt,
    }
    if (folder) {
      const list = byRootUri.get(folder.root.uri) ?? []
      list.push(entry)
      byRootUri.set(folder.root.uri, list)
    } else {
      orphans.push(entry)
    }
  }

  const groups: HomeProjectGroup[] = workspace.folders.map(folder => ({
    id: folder.id,
    name: folder.root.name,
    path: folder.root.path,
    rootUri: folder.root.uri,
    terminals: byRootUri.get(folder.root.uri) ?? [],
  }))

  if (orphans.length > 0) {
    groups.push({
      id: "yaade:terminal-explorer:other",
      name: "Other",
      path: "",
      rootUri: "",
      terminals: orphans,
    })
  }

  return groups
}
