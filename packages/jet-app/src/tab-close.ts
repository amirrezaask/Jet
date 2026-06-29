import type { TabId } from "@jet/shared"
import type { WorkspaceService } from "@jet/workspace"

export function confirmCloseEditorTab(workspace: WorkspaceService, tabId: TabId): boolean {
  const kind = workspace.tabRegistry.get(tabId)
  if (kind?.kind !== "editor") return true
  const file = workspace.fileForUri(kind.fileUri)
  if (!file?.isDirty) return true
  const label = workspace.tabRegistry.meta(tabId).label
  return window.confirm(`"${label}" has unsaved changes. Close anyway?`)
}
