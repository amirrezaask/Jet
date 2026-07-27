import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js"
import { canonicalizeFileUri } from "@gharargah/shared"
import type { MonacoModelRegistry } from "./model-registry.js"
import { positionToOffset, offsetToPosition, type Utf16Position } from "./utf16.js"

export type LspPosition = { line: number; character: number }
export type LspRange = { start: LspPosition; end: LspPosition }

export type LspTextEdit = {
  range: LspRange
  newText: string
}

export type LspVersionedTextDocumentIdentifier = {
  uri: string
  version?: number | null
}

export type LspTextDocumentEdit = {
  textDocument: LspVersionedTextDocumentIdentifier
  edits: LspTextEdit[]
}

export type LspCreateFile = {
  kind: "create"
  uri: string
  options?: { overwrite?: boolean; ignoreIfExists?: boolean }
}

export type LspRenameFile = {
  kind: "rename"
  oldUri: string
  newUri: string
  options?: { overwrite?: boolean; ignoreIfExists?: boolean }
}

export type LspDeleteFile = {
  kind: "delete"
  uri: string
  options?: { recursive?: boolean; ignoreIfNotExists?: boolean }
}

export type LspDocumentChange =
  | LspTextEdit
  | LspTextDocumentEdit
  | LspCreateFile
  | LspRenameFile
  | LspDeleteFile

export type LspWorkspaceEdit = {
  changes?: Record<string, LspTextEdit[]>
  documentChanges?: LspDocumentChange[]
}

export type FileOperation =
  | { kind: "create"; uri: string; options?: LspCreateFile["options"] }
  | { kind: "rename"; oldUri: string; newUri: string; options?: LspRenameFile["options"] }
  | { kind: "delete"; uri: string; options?: LspDeleteFile["options"] }

export type ApplyWorkspaceEditOptions = {
  registry: MonacoModelRegistry
  isDirty: (uri: string) => boolean
  getVersion?: (uri: string) => number | undefined
  getContent?: (uri: string) => string | undefined
  defaultLanguageId?: string
}

export type SkippedEdit = {
  uri: string
  reason: string
}

export type ApplyWorkspaceEditResult = {
  applied: string[]
  skipped: SkippedEdit[]
  fileOperations: FileOperation[]
}

function isTextDocumentEdit(change: LspDocumentChange): change is LspTextDocumentEdit {
  return "textDocument" in change && "edits" in change
}

function isCreateFile(change: LspDocumentChange): change is LspCreateFile {
  return "kind" in change && change.kind === "create"
}

function isRenameFile(change: LspDocumentChange): change is LspRenameFile {
  return "kind" in change && change.kind === "rename"
}

function isDeleteFile(change: LspDocumentChange): change is LspDeleteFile {
  return "kind" in change && change.kind === "delete"
}

function isBareTextEdit(change: LspDocumentChange): change is LspTextEdit {
  return "range" in change && "newText" in change && !("textDocument" in change)
}

function canonicalUri(uri: string): string {
  return uri.startsWith("file://") ? canonicalizeFileUri(uri) : uri
}

function sortEditsDescending(edits: LspTextEdit[]): LspTextEdit[] {
  return [...edits].sort((a, b) => {
    if (a.range.start.line !== b.range.start.line) return b.range.start.line - a.range.start.line
    if (a.range.start.character !== b.range.start.character) {
      return b.range.start.character - a.range.start.character
    }
    if (a.range.end.line !== b.range.end.line) return b.range.end.line - a.range.end.line
    return b.range.end.character - a.range.end.character
  })
}

function applyTextEditsToContent(content: string, edits: LspTextEdit[]): string {
  let result = content
  for (const edit of sortEditsDescending(edits)) {
    const start = positionToOffset(result, edit.range.start)
    const end = positionToOffset(result, edit.range.end)
    result = result.slice(0, start) + edit.newText + result.slice(end)
  }
  return result
}

function applyTextEditsToModel(model: monaco.editor.ITextModel, edits: LspTextEdit[]): void {
  const sorted = sortEditsDescending(edits)
  const operations = sorted.map(edit => ({
    range: lspRangeToMonacoRange(edit.range, model),
    text: edit.newText,
  }))
  model.pushEditOperations([], operations, () => null)
}

function lspRangeToMonacoRange(range: LspRange, model: monaco.editor.ITextModel): monaco.IRange {
  const startOffset = positionToOffset(model.getValue(), range.start)
  const endOffset = positionToOffset(model.getValue(), range.end)
  const start = model.getPositionAt(startOffset)
  const end = model.getPositionAt(endOffset)
  return {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column,
  }
}

function validateVersion(
  uri: string,
  expectedVersion: number | null | undefined,
  getVersion: ((uri: string) => number | undefined) | undefined,
): string | null {
  if (expectedVersion == null || !getVersion) return null
  const current = getVersion(uri)
  if (current == null) return null
  if (current !== expectedVersion) {
    return `version mismatch: expected ${expectedVersion}, got ${current}`
  }
  return null
}

function collectDocumentEdits(edit: LspWorkspaceEdit): Map<string, LspTextEdit[]> {
  const byUri = new Map<string, LspTextEdit[]>()

  if (edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      const key = canonicalUri(uri)
      const existing = byUri.get(key) ?? []
      byUri.set(key, existing.concat(edits))
    }
  }

  if (edit.documentChanges) {
    for (const change of edit.documentChanges) {
      if (isBareTextEdit(change)) continue
      if (isTextDocumentEdit(change)) {
        const key = canonicalUri(change.textDocument.uri)
        const existing = byUri.get(key) ?? []
        byUri.set(key, existing.concat(change.edits))
      }
    }
  }

  return byUri
}

/** Apply an LSP workspace edit to in-memory Monaco models. */
export function applyWorkspaceEdit(
  edit: LspWorkspaceEdit,
  options: ApplyWorkspaceEditOptions,
): ApplyWorkspaceEditResult {
  const applied: string[] = []
  const skipped: SkippedEdit[] = []
  const fileOperations: FileOperation[] = []
  const { registry, isDirty, getVersion, getContent, defaultLanguageId = "plaintext" } = options

  if (edit.documentChanges) {
    for (const change of edit.documentChanges) {
      if (isCreateFile(change)) {
        fileOperations.push({ kind: "create", uri: canonicalUri(change.uri), options: change.options })
        continue
      }
      if (isRenameFile(change)) {
        fileOperations.push({
          kind: "rename",
          oldUri: canonicalUri(change.oldUri),
          newUri: canonicalUri(change.newUri),
          options: change.options,
        })
        continue
      }
      if (isDeleteFile(change)) {
        fileOperations.push({ kind: "delete", uri: canonicalUri(change.uri), options: change.options })
        continue
      }
      if (isTextDocumentEdit(change)) {
        const uri = canonicalUri(change.textDocument.uri)
        const versionError = validateVersion(uri, change.textDocument.version, getVersion)
        if (versionError) {
          skipped.push({ uri, reason: versionError })
          continue
        }
      }
    }
  }

  const documentEdits = collectDocumentEdits(edit)

  for (const [uri, edits] of documentEdits) {
    if (isDirty(uri)) {
      skipped.push({ uri, reason: "buffer has unsaved changes" })
      continue
    }

    let model = registry.get(uri)
    if (!model) {
      const initial = getContent?.(uri) ?? ""
      model = registry.getOrCreate(uri, initial, defaultLanguageId)
      registry.release(uri)
    }

    const versionFromChanges = edit.documentChanges
      ?.filter(isTextDocumentEdit)
      .find(dc => canonicalUri(dc.textDocument.uri) === uri)?.textDocument.version

    const versionError = validateVersion(uri, versionFromChanges, getVersion)
    if (versionError) {
      skipped.push({ uri, reason: versionError })
      continue
    }

    applyTextEditsToModel(model, edits)
    applied.push(uri)
  }

  return { applied, skipped, fileOperations }
}

/** Apply text edits to a string (test-friendly, no Monaco dependency). */
export function applyTextEditsToString(content: string, edits: LspTextEdit[]): string {
  return applyTextEditsToContent(content, edits)
}

/** Convert a Monaco range to an LSP range using UTF-16 positions. */
export function monacoRangeToLspRange(
  content: string,
  range: monaco.IRange,
): LspRange {
  const startOffset = lineColumnToOffset(content, range.startLineNumber, range.startColumn)
  const endOffset = lineColumnToOffset(content, range.endLineNumber, range.endColumn)
  return {
    start: offsetToPosition(content, startOffset),
    end: offsetToPosition(content, endOffset),
  }
}

function lineColumnToOffset(content: string, lineNumber: number, column: number): number {
  let line = 1
  let character = 0
  for (let i = 0; i < content.length; i++) {
    if (line === lineNumber && character === column - 1) return i
    const code = content.charCodeAt(i)
    if (code === 13) {
      if (i + 1 < content.length && content.charCodeAt(i + 1) === 10) {
        line++
        character = 0
        i++
      } else {
        line++
        character = 0
      }
    } else if (code === 10) {
      line++
      character = 0
    } else {
      character++
    }
  }
  return content.length
}

export type { Utf16Position }
