import { canonicalizeFileUri } from "@yaade/shared"
import type { Command, WorkspaceEdit } from "vscode-languageserver-protocol"

export type ResourceEditPolicy = {
  isUriAllowed(uri: string): boolean
  isDirty(uri: string): boolean
}

export function workspaceEditIsEmpty(edit: WorkspaceEdit): boolean {
  const legacyEdits = Object.values(edit.changes ?? {}).some(edits => edits.length > 0)
  return !legacyEdits && (edit.documentChanges?.length ?? 0) === 0
}

export function resourceOperationUris(edit: WorkspaceEdit): string[] {
  const uris: string[] = []
  for (const operation of edit.documentChanges ?? []) {
    if ("textDocument" in operation) continue
    if (operation.kind === "rename") {
      uris.push(canonicalizeFileUri(operation.oldUri), canonicalizeFileUri(operation.newUri))
    } else {
      uris.push(canonicalizeFileUri(operation.uri))
    }
  }
  return uris
}

export function atomicResourceEditCommand(
  edit: WorkspaceEdit | undefined,
  serverCommand: Command | undefined,
  commandId: string | undefined,
  title: string,
): { id: string; title: string; arguments: [WorkspaceEdit, Command | undefined] } | undefined {
  if (!edit || !commandId || resourceOperationUris(edit).length === 0) return undefined
  return { id: commandId, title, arguments: [edit, serverCommand] }
}

export function validateResourceWorkspaceEdit(
  edit: WorkspaceEdit,
  policy: ResourceEditPolicy,
): { valid: true } | { valid: false; reason: string } {
  for (const uri of resourceOperationUris(edit)) {
    if (!policy.isUriAllowed(uri)) {
      return {
        valid: false,
        reason: `Language-server edit is outside the allowed roots: ${uri}`,
      }
    }
    if (policy.isDirty(uri)) {
      return {
        valid: false,
        reason: `Language-server edit conflicts with dirty buffer: ${uri}`,
      }
    }
  }
  return { valid: true }
}
