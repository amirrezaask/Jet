import type { WorkspaceService } from "@gharargah/workspace"
import { requestConfirm } from "@gharargah/ui"

export async function confirmCloseBuffer(
  workspace: WorkspaceService,
  fileUri: string,
): Promise<boolean> {
  const file = workspace.fileForUri(fileUri)
  if (!file?.isDirty) return true
  return requestConfirm({
    title: "Unsaved changes",
    description: `"${file.name}" has unsaved changes. Close anyway?`,
    confirmLabel: "Close",
    cancelLabel: "Cancel",
    destructive: true,
  })
}
