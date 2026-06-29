import { PanelTree } from "@jet/panels"
import type { PanelId, PanelTreeSnapshot, TabId } from "@jet/shared"
import { fileUriToPath, isUntitledUri } from "@jet/shared"
import type { TabKind, TabMeta, WorkspaceService } from "@jet/workspace"

const SESSION_PREFIX = "jet-session:"
const LAST_WORKSPACE_KEY = "jet-last-workspace"

export function saveLastWorkspace(folderPath: string): void {
  try {
    localStorage.setItem(LAST_WORKSPACE_KEY, folderPath)
  } catch {
    /* quota */
  }
}

export function loadLastWorkspace(): string | null {
  try {
    return localStorage.getItem(LAST_WORKSPACE_KEY)
  } catch {
    return null
  }
}

function isEditorKind(kind: TabKind): boolean {
  return kind.kind === "editor"
}

export type SerializedTab = {
  tabId: number
  kind: TabKind
  meta: TabMeta
  panelId?: number
}

export type WorkspaceSession = {
  tree: PanelTreeSnapshot
  tabs: SerializedTab[]
  editorPanelId?: number
  focusedPanelId?: number
  singletons: {
    explorer?: number
    git?: number
    terminal?: number
    search?: number
    problems?: number
  }
}

export function sessionKeyForWorkspace(folderPath: string): string {
  return `${SESSION_PREFIX}${folderPath}`
}

export function saveWorkspaceSession(
  folderPath: string,
  tree: PanelTree,
  workspace: WorkspaceService,
  editorPanelId: PanelId | null,
  focusedPanelId: PanelId | null,
  _singletons: WorkspaceSession["singletons"],
): void {
  const tabs: SerializedTab[] = workspace.tabRegistry
    .allTabs()
    .filter(tabId => {
      const kind = workspace.tabRegistry.get(tabId)
      return kind != null && isEditorKind(kind)
    })
    .map(tabId => ({
      tabId: tabId.id,
      kind: workspace.tabRegistry.get(tabId)!,
      meta: workspace.tabRegistry.meta(tabId),
      panelId: workspace.tabRegistry.panelForTab(tabId)?.id,
    }))

  const session: WorkspaceSession = {
    tree: tree.toJSON(),
    tabs,
    editorPanelId: editorPanelId?.id,
    focusedPanelId: focusedPanelId?.id,
    singletons: {},
  }

  try {
    localStorage.setItem(sessionKeyForWorkspace(folderPath), JSON.stringify(session))
  } catch {
    /* quota */
  }
}

export function loadWorkspaceSession(folderPath: string): WorkspaceSession | null {
  try {
    const raw = localStorage.getItem(sessionKeyForWorkspace(folderPath))
    if (!raw) return null
    return JSON.parse(raw) as WorkspaceSession
  } catch {
    return null
  }
}

export function restoreWorkspaceSession(
  session: WorkspaceSession,
  workspace: WorkspaceService,
): {
  tree: PanelTree
  editorPanel: PanelId | null
  focusedPanel: PanelId | null
  singletons: WorkspaceSession["singletons"]
} {
  const tree = PanelTree.fromJSON(session.tree)
  const editorEntries = session.tabs.filter(entry => isEditorKind(entry.kind))
  const knownTabIds = new Set(editorEntries.map(t => t.tabId))
  tree.sanitizeKnownTabs(tabId => knownTabIds.has(tabId.id))

  workspace.tabRegistry.clear()
  for (const entry of editorEntries) {
    if (!tree.findPanelForTab({ id: entry.tabId })) continue
    const tabId: TabId = { id: entry.tabId }
    const panelId: PanelId | undefined =
      entry.panelId != null ? { id: entry.panelId } : tree.findPanelForTab(tabId) ?? undefined
    workspace.tabRegistry.set(
      tabId,
      entry.kind,
      { ...entry.meta, dirty: false },
      panelId,
    )

    if (entry.kind.kind === "editor" && !isUntitledUri(entry.kind.fileUri)) {
      const path = fileUriToPath(entry.kind.fileUri)
      if (!workspace.fileForUri(entry.kind.fileUri)) {
        workspace.createWorkspaceFile(entry.kind.fileUri, path)
      }
    }
  }

  return {
    tree,
    editorPanel: session.editorPanelId != null ? { id: session.editorPanelId } : null,
    focusedPanel: session.focusedPanelId != null ? { id: session.focusedPanelId } : null,
    singletons: {},
  }
}
