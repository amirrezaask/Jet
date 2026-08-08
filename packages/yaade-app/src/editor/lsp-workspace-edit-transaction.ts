import { canonicalizeFileUri } from "@yaade/shared"
import type { JetLspWorkspaceDeps } from "@yaade/lsp"
import type {
  LspCreateFile,
  LspDeleteFile,
  LspRenameFile,
  LspTextEdit,
} from "@yaade/monaco"
import type { JetElectronFS, TrashEntry } from "@yaade/workspace"
import {
  WorkspaceEditTransactionService,
  WorkspaceEditConflictError,
  applyWorkspaceTextEdits,
  type OpenTextDocument,
  type WorkspaceTextEdit,
  type WorkspaceTextEditRequest,
} from "./workspace-edit-transaction.js"

export type LspResourceOperation = LspCreateFile | LspRenameFile | LspDeleteFile
type ResourceOperation = LspResourceOperation
type ProtocolWorkspaceEdit = Parameters<
  NonNullable<JetLspWorkspaceDeps["applyWorkspaceEditTransaction"]>
>[0]
type ProtocolTextDocumentEdit = {
  textDocument: { uri: string; version?: number | null }
  edits: readonly unknown[]
}

type PlannedResourceOperation =
  | { operation: LspCreateFile; skip: boolean; backupExisting: boolean }
  | { operation: LspRenameFile; skip: boolean; backupExisting: boolean }
  | { operation: LspDeleteFile; skip: boolean }

type AppliedResourceOperation =
  | { kind: "create"; uri: string; backup?: TrashEntry }
  | { kind: "rename"; oldUri: string; newUri: string; backup?: TrashEntry }
  | { kind: "delete"; trash: TrashEntry }

type VirtualContent = {
  /** Disk/model content after resources but before text edits. */
  base: string
  current: string
  /** Physical source URI before resource mutations; null for a new file. */
  origin: string | null
  /** False for a lazily planned rename whose source has not been read yet. */
  loaded: boolean
}

export type LspWorkspaceEditTransactionDependencies = {
  fs: Pick<
    JetElectronFS,
    | "readTextFile"
    | "exists"
    | "stat"
    | "readDir"
    | "createFile"
    | "rename"
    | "trash"
    | "restoreTrash"
  >
  transactions: WorkspaceEditTransactionService
  getOpenDocument(uri: string): OpenTextDocument | null
  isOpen(uri: string): boolean
  isDirty(uri: string): boolean
  isUriAllowed(uri: string): boolean
  getDocumentVersion(uri: string): number | undefined
  /** Prepare clean open-buffer/tab reconciliation before disk mutation. */
  prepareOpenResourceReconciliation?(
    operations: readonly LspResourceOperation[],
  ): Promise<{
    /** Runs after every disk resource operation succeeds. */
    apply(): void | Promise<void>
    /** Runs after disk rollback, including when apply only partly completed. */
    rollback(): void | Promise<void>
  }>
}

function canonicalUri(uri: string): string {
  return uri.startsWith("file://") ? canonicalizeFileUri(uri) : uri
}

function isTextDocumentEdit(change: unknown): change is ProtocolTextDocumentEdit {
  return (
    change != null &&
    typeof change === "object" &&
    "textDocument" in change &&
    "edits" in change
  )
}

function isResourceOperation(change: unknown): change is ResourceOperation {
  return (
    change != null &&
    typeof change === "object" &&
    "kind" in change &&
    (change.kind === "create" ||
      change.kind === "rename" ||
      change.kind === "delete")
  )
}

function workspaceTextEdits(edits: readonly unknown[]): WorkspaceTextEdit[] {
  return edits.map(edit => {
    if (
      edit == null ||
      typeof edit !== "object" ||
      !("range" in edit) ||
      !("newText" in edit) ||
      typeof edit.newText !== "string"
    ) {
      throw new Error("Workspace edit contains an unsupported snippet text edit")
    }
    const textEdit = edit as LspTextEdit
    return {
    range: {
      startLine: textEdit.range.start.line + 1,
      startColumn: textEdit.range.start.character + 1,
      endLine: textEdit.range.end.line + 1,
      endColumn: textEdit.range.end.character + 1,
    },
    text: textEdit.newText,
    }
  })
}

function fullDocumentEdit(from: string, to: string): WorkspaceTextEdit {
  let line = 1
  let column = 1
  for (let index = 0; index < from.length; index += 1) {
    const code = from.charCodeAt(index)
    if (code === 10) {
      line += 1
      column = 1
    } else if (code !== 13) {
      column += 1
    }
  }
  return {
    range: {
      startLine: 1,
      startColumn: 1,
      endLine: line,
      endColumn: column,
    },
    text: to,
  }
}

function resourceUris(operation: ResourceOperation): string[] {
  if (operation.kind === "rename") {
    return [canonicalUri(operation.oldUri), canonicalUri(operation.newUri)]
  }
  return [canonicalUri(operation.uri)]
}

export async function applyLspWorkspaceEditTransaction(
  edit: ProtocolWorkspaceEdit,
  options: { allowDirty?: boolean; atomic: true },
  dependencies: LspWorkspaceEditTransactionDependencies,
): Promise<{ applied: boolean; reason?: string }> {
  try {
    const existsCache = new Map<string, boolean>()
    const virtualExists = new Map<string, boolean>()
    const content = new Map<string, VirtualContent>()
    const resources: PlannedResourceOperation[] = []

    const exists = async (uri: string): Promise<boolean> => {
      if (virtualExists.has(uri)) return virtualExists.get(uri)!
      if (existsCache.has(uri)) return existsCache.get(uri)!
      let value = false
      try {
        value = dependencies.fs.exists
          ? await dependencies.fs.exists(uri)
          : Boolean(await dependencies.fs.stat(uri))
      } catch {
        value = false
      }
      existsCache.set(uri, value)
      virtualExists.set(uri, value)
      return value
    }

    const assertAllowed = (uri: string) => {
      if (!uri.startsWith("file://") || !dependencies.isUriAllowed(uri)) {
        throw new Error(`Workspace edit path is outside the active roots: ${uri}`)
      }
    }

    const assertResourceBufferSafe = (uri: string) => {
      if (dependencies.isDirty(uri)) {
        throw new Error(`Save or discard the dirty buffer before changing its path: ${uri}`)
      }
    }

    const loadContent = async (uri: string): Promise<VirtualContent> => {
      const existing = content.get(uri)
      if (existing) {
        if (!existing.loaded && existing.origin) {
          const open = dependencies.getOpenDocument(existing.origin)
          const base = open
            ? open.readText()
            : (await dependencies.fs.readTextFile(existing.origin)).content
          existing.base = base
          existing.current = base
          existing.loaded = true
        }
        return existing
      }
      if (!(await exists(uri))) throw new Error(`Workspace edit file does not exist: ${uri}`)
      const open = dependencies.getOpenDocument(uri)
      const base = open ? open.readText() : (await dependencies.fs.readTextFile(uri)).content
      const state = { base, current: base, origin: uri, loaded: true }
      content.set(uri, state)
      return state
    }

    const applyText = async (
      uriInput: string,
      edits: readonly unknown[],
      expectedVersion?: number | null,
    ) => {
      const uri = canonicalUri(uriInput)
      assertAllowed(uri)
      if (!options.allowDirty && dependencies.isDirty(uri)) {
        throw new Error(`Workspace edit conflicts with a dirty buffer: ${uri}`)
      }
      if (expectedVersion != null) {
        const actual = dependencies.getDocumentVersion(uri)
        if (actual != null && actual !== expectedVersion) {
          throw new Error(
            `Workspace edit version mismatch for ${uri}: expected ${expectedVersion}, got ${actual}`,
          )
        }
      }
      const state = await loadContent(uri)
      state.current = applyWorkspaceTextEdits(
        state.current,
        workspaceTextEdits(edits),
      )
    }

    const planResource = async (raw: ResourceOperation) => {
      const operation: ResourceOperation =
        raw.kind === "rename"
          ? {
              ...raw,
              oldUri: canonicalUri(raw.oldUri),
              newUri: canonicalUri(raw.newUri),
            }
          : { ...raw, uri: canonicalUri(raw.uri) }
      for (const uri of resourceUris(operation)) assertAllowed(uri)

      if (operation.kind === "create") {
        assertResourceBufferSafe(operation.uri)
        const targetExists = await exists(operation.uri)
        const overwrite = operation.options?.overwrite === true
        const skip = targetExists && !overwrite && operation.options?.ignoreIfExists === true
        if (targetExists && !overwrite && !skip) {
          throw new Error(`Workspace edit create target already exists: ${operation.uri}`)
        }
        resources.push({ operation, skip, backupExisting: targetExists && overwrite })
        if (!skip) {
          virtualExists.set(operation.uri, true)
          content.set(operation.uri, {
            base: "",
            current: "",
            origin: null,
            loaded: true,
          })
        }
        return
      }

      if (operation.kind === "rename") {
        assertResourceBufferSafe(operation.oldUri)
        assertResourceBufferSafe(operation.newUri)
        if (!(await exists(operation.oldUri))) {
          throw new Error(`Workspace edit rename source does not exist: ${operation.oldUri}`)
        }
        const targetExists = await exists(operation.newUri)
        const overwrite = operation.options?.overwrite === true
        const skip = targetExists && !overwrite && operation.options?.ignoreIfExists === true
        if (targetExists && !overwrite && !skip) {
          throw new Error(`Workspace edit rename target already exists: ${operation.newUri}`)
        }
        resources.push({ operation, skip, backupExisting: targetExists && overwrite })
        if (!skip) {
          virtualExists.set(operation.oldUri, false)
          virtualExists.set(operation.newUri, true)
          const moved = content.get(operation.oldUri)
          content.delete(operation.oldUri)
          if (moved) content.set(operation.newUri, moved)
          else {
            content.set(operation.newUri, {
              base: "",
              current: "",
              origin: operation.oldUri,
              loaded: false,
            })
          }
        }
        return
      }

      assertResourceBufferSafe(operation.uri)
      const sourceExists = await exists(operation.uri)
      const skip = !sourceExists && operation.options?.ignoreIfNotExists === true
      if (!sourceExists && !skip) {
        throw new Error(`Workspace edit delete target does not exist: ${operation.uri}`)
      }
      if (!skip) {
        const stat = await dependencies.fs.stat(operation.uri)
        if (stat.isDirectory && operation.options?.recursive !== true) {
          const children = await dependencies.fs.readDir(operation.uri)
          if (children.length > 0) {
            throw new Error(`Workspace edit cannot delete a non-empty folder without recursive: ${operation.uri}`)
          }
        }
      }
      resources.push({ operation, skip })
      if (!skip) {
        virtualExists.set(operation.uri, false)
        content.delete(operation.uri)
      }
    }

    for (const change of edit.documentChanges ?? []) {
      if (isTextDocumentEdit(change)) {
        await applyText(
          change.textDocument.uri,
          change.edits,
          change.textDocument.version,
        )
      } else if (isResourceOperation(change)) {
        await planResource(change)
      }
    }
    for (const [uri, edits] of Object.entries(edit.changes ?? {})) {
      await applyText(uri, edits)
    }

    // A lazily moved file needs its source content only if it survives and is edited.
    for (const [uri, state] of content) {
      if (state.origin && !state.loaded) {
        const open = dependencies.getOpenDocument(state.origin)
        const base = open
          ? open.readText()
          : (await dependencies.fs.readTextFile(state.origin)).content
        state.base = base
        state.current = base
        state.loaded = true
      }
      if (!(await exists(uri))) content.delete(uri)
    }

    const textRequests: WorkspaceTextEditRequest[] = [...content]
      .filter(([, state]) => state.current !== state.base)
      .map(([uri, state]) => ({
        uri,
        edits: [fullDocumentEdit(state.base, state.current)],
      }))

    const appliedOperations = resources
      .filter(plan => !plan.skip)
      .map(plan => plan.operation)
    const openResourceReconciliation =
      dependencies.prepareOpenResourceReconciliation && appliedOperations.length > 0
        ? await dependencies.prepareOpenResourceReconciliation(appliedOperations)
        : undefined
    const appliedResources: AppliedResourceOperation[] = []
    try {
      for (const plan of resources) {
        if (plan.skip) continue
        const operation = plan.operation
        if (operation.kind === "create") {
          const backup = "backupExisting" in plan && plan.backupExisting
            ? await dependencies.fs.trash(operation.uri)
            : undefined
          await dependencies.fs.createFile(operation.uri)
          appliedResources.push({ kind: "create", uri: operation.uri, backup })
        } else if (operation.kind === "rename") {
          const backup = "backupExisting" in plan && plan.backupExisting
            ? await dependencies.fs.trash(operation.newUri)
            : undefined
          await dependencies.fs.rename(operation.oldUri, operation.newUri)
          appliedResources.push({
            kind: "rename",
            oldUri: operation.oldUri,
            newUri: operation.newUri,
            backup,
          })
        } else {
          const trash = await dependencies.fs.trash(operation.uri)
          appliedResources.push({ kind: "delete", trash })
        }
      }

      await openResourceReconciliation?.apply()

      if (textRequests.length > 0) {
        const preview = await dependencies.transactions.preview(textRequests)
        for (const file of preview.files) {
          const planned = content.get(file.uri)
          if (!planned || file.before !== planned.base) {
            throw new WorkspaceEditConflictError(
              file.uri,
              `File changed while the workspace edit was being prepared: ${file.uri}`,
            )
          }
        }
        await dependencies.transactions.apply(preview)
      }
      return { applied: true }
    } catch (error) {
      for (const operation of [...appliedResources].reverse()) {
        try {
          if (operation.kind === "create") {
            await dependencies.fs.trash(operation.uri)
            if (operation.backup) {
              await dependencies.fs.restoreTrash(operation.backup.id)
            }
          } else if (operation.kind === "rename") {
            await dependencies.fs.rename(operation.newUri, operation.oldUri)
            if (operation.backup) {
              await dependencies.fs.restoreTrash(operation.backup.id)
            }
          } else {
            await dependencies.fs.restoreTrash(operation.trash.id)
          }
        } catch {
          // Trash-based rollback remains recoverable and must not hide the root failure.
        }
      }
      try {
        await openResourceReconciliation?.rollback()
      } catch {
        // Keep the original transaction failure; restored files remain durable.
      }
      throw error
    }
  } catch (error) {
    return {
      applied: false,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}
