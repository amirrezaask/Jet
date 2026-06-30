import type { WorkspaceService } from "@jet/workspace"

export function confirmCloseBuffer(workspace: WorkspaceService, fileUri: string): boolean {
  const file = workspace.fileForUri(fileUri)
  if (!file?.isDirty) return true
  return window.confirm(`"${file.name}" has unsaved changes. Close anyway?`)
}
