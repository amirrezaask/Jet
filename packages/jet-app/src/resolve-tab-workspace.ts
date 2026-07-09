import type { JetPanelTree, KnownTabKind, WorkspaceFolder, WorkspaceService } from "@jet/workspace"
import { folderForFileUri, folderForRootUri } from "@jet/workspace"
import type { PanelId } from "@jet/shared"
import { isUntitledUri } from "@jet/shared"
import { activeTabKind, getActiveEditorFileUri, getActiveTabId, type ActiveTabKind } from "./panel-tab-context.js"
import { parseAgentChatTabId } from "./tabs/agent-chat-id.js"
import { terminalCwdForTab } from "./tabs/terminal-session.js"

function isContextualTabKind(kind: ActiveTabKind | undefined): kind is KnownTabKind {
  return kind === "editor" || kind === "terminal" || kind === "agent-chat"
}

/** Workspace folder implied by the active tab in `panel`. */
export function resolveFolderForActiveTab(
  tree: JetPanelTree,
  panel: PanelId | null,
  tabRegistry: { kindFor(id: string): KnownTabKind | undefined },
  workspace: WorkspaceService,
): WorkspaceFolder | null {
  if (!panel) return workspace.manager.activeFolder ?? workspace.folders[0] ?? null

  const tabId = getActiveTabId(tree, panel)
  const kind = activeTabKind(tree, panel, tabRegistry)

  if (kind === "terminal" && tabId) {
    const folder = folderForRootUri(workspace, terminalCwdForTab(tabId))
    if (folder) return folder
  }

  if (kind === "agent-chat" && tabId) {
    const parsed = parseAgentChatTabId(tabId)
    if (parsed) {
      const folder = folderForRootUri(workspace, parsed.rootUri)
      if (folder) return folder
    }
  }

  const fileUri = getActiveEditorFileUri(tree, panel)
  if (fileUri) {
    const folder = folderForFileUri(workspace, fileUri)
    if (folder) return folder
  }

  if (tabId && tabId.startsWith("file:") && !isUntitledUri(tabId)) {
    const folder = folderForFileUri(workspace, tabId)
    if (folder) return folder
  }

  return workspace.manager.activeFolder ?? workspace.folders[0] ?? null
}

/**
 * Folder for quick open / project search. Uses the focused tab when it carries
 * workspace context; otherwise falls back to the last contextual tab or active folder.
 */
export function resolveContextWorkspaceFolder(
  tree: JetPanelTree,
  panel: PanelId | null,
  tabRegistry: { kindFor(id: string): KnownTabKind | undefined },
  workspace: WorkspaceService,
  lastContextFolder: WorkspaceFolder | null,
): WorkspaceFolder | null {
  const kind = activeTabKind(tree, panel, tabRegistry)
  const fromTab = resolveFolderForActiveTab(tree, panel, tabRegistry, workspace)

  if (fromTab && isContextualTabKind(kind)) return fromTab
  if (lastContextFolder) return lastContextFolder
  return fromTab ?? workspace.manager.activeFolder ?? workspace.folders[0] ?? null
}

export { isContextualTabKind }
