import {
  fileUriToPath,
  pathToFileUri,
  type ProjectSearchResult,
  type SearchMatchRange,
} from "@yaade/shared"

export type WorkspaceTextEdit = {
  /** 1-based UTF-16 positions. The end position is exclusive. */
  range: SearchMatchRange
  text: string
}

export type WorkspaceTextEditRequest = {
  uri: string
  edits: readonly WorkspaceTextEdit[]
}

export type OpenTextDocument = {
  readText(): string
  applyEdits(edits: readonly WorkspaceTextEdit[]): void
  /** Undo the most recent isolated edit group, preserving saved-version identity. */
  undoLastEdit?(): void | Promise<void>
}

export type WorkspaceEditTransactionDependencies = {
  getOpenDocument(uri: string): OpenTextDocument | null
  readTextFile(uri: string): Promise<{
    content: string
    version: string
    size: number
  }>
  writeTextFile(
    uri: string,
    content: string,
    options: { expectedVersion: string },
  ): Promise<{ version: string; size: number }>
}

export type WorkspaceEditPreviewFile = {
  uri: string
  before: string
  after: string
  diskVersion: string | null
  open: boolean
  edits: readonly WorkspaceTextEdit[]
}

export type WorkspaceEditPreview = {
  files: readonly WorkspaceEditPreviewFile[]
  editCount: number
}

type AppliedFile = WorkspaceEditPreviewFile & {
  afterDiskVersion: string | null
}

export class WorkspaceEditConflictError extends Error {
  readonly code = "FILE_CHANGED"

  constructor(readonly uri: string, message = `File changed before edits could be applied: ${uri}`) {
    super(message)
    this.name = "WorkspaceEditConflictError"
  }
}

function offsetAt(text: string, line: number, column: number): number {
  if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1) {
    throw new RangeError(`Invalid text position ${line}:${column}`)
  }
  let currentLine = 1
  let lineStart = 0
  while (currentLine < line) {
    const newline = text.indexOf("\n", lineStart)
    if (newline < 0) throw new RangeError(`Line ${line} is outside the document`)
    lineStart = newline + 1
    currentLine++
  }
  const newline = text.indexOf("\n", lineStart)
  const rawLineEnd = newline < 0 ? text.length : newline
  const lineEnd = rawLineEnd > lineStart && text.charCodeAt(rawLineEnd - 1) === 13
    ? rawLineEnd - 1
    : rawLineEnd
  const offset = lineStart + column - 1
  if (offset > lineEnd) {
    throw new RangeError(`Column ${column} is outside line ${line}`)
  }
  return offset
}

function normalizeEdits(
  text: string,
  edits: readonly WorkspaceTextEdit[],
): Array<WorkspaceTextEdit & { start: number; end: number }> {
  const normalized = edits.map(edit => {
    const start = offsetAt(text, edit.range.startLine, edit.range.startColumn)
    const end = offsetAt(text, edit.range.endLine, edit.range.endColumn)
    if (end < start) throw new RangeError("Text edit ends before it starts")
    return { ...edit, start, end }
  }).sort((a, b) => a.start - b.start || a.end - b.end)
  for (let index = 1; index < normalized.length; index++) {
    if (normalized[index]!.start < normalized[index - 1]!.end) {
      throw new RangeError("Overlapping workspace edits are not supported")
    }
  }
  return normalized
}

export function applyWorkspaceTextEdits(
  text: string,
  edits: readonly WorkspaceTextEdit[],
): string {
  const normalized = normalizeEdits(text, edits)
  let next = text
  for (let index = normalized.length - 1; index >= 0; index--) {
    const edit = normalized[index]!
    next = `${next.slice(0, edit.start)}${edit.text}${next.slice(edit.end)}`
  }
  return next
}

function fullDocumentEdit(from: string, to: string): WorkspaceTextEdit {
  let line = 1
  let column = 1
  for (let index = 0; index < from.length; index++) {
    if (from.charCodeAt(index) === 10) {
      line++
      column = 1
    } else if (from.charCodeAt(index) !== 13) {
      column++
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

/**
 * Preflights every document before mutation, writes closed files with version
 * guards, and leaves open Monaco documents dirty instead of auto-saving them.
 */
export class WorkspaceEditTransactionService {
  private lastApplied: readonly AppliedFile[] | null = null

  constructor(private readonly dependencies: WorkspaceEditTransactionDependencies) {}

  canUndo(): boolean {
    return this.lastApplied != null
  }

  async preview(requests: readonly WorkspaceTextEditRequest[]): Promise<WorkspaceEditPreview> {
    const merged = new Map<string, WorkspaceTextEdit[]>()
    for (const request of requests) {
      if (request.edits.length === 0) continue
      const edits = merged.get(request.uri) ?? []
      edits.push(...request.edits)
      merged.set(request.uri, edits)
    }
    const files = await Promise.all([...merged].map(async ([uri, edits]) => {
      const openDocument = this.dependencies.getOpenDocument(uri)
      if (openDocument) {
        const before = openDocument.readText()
        return {
          uri,
          before,
          after: applyWorkspaceTextEdits(before, edits),
          diskVersion: null,
          open: true,
          edits,
        } satisfies WorkspaceEditPreviewFile
      }
      const disk = await this.dependencies.readTextFile(uri)
      return {
        uri,
        before: disk.content,
        after: applyWorkspaceTextEdits(disk.content, edits),
        diskVersion: disk.version,
        open: false,
        edits,
      } satisfies WorkspaceEditPreviewFile
    }))
    return {
      files,
      editCount: files.reduce((count, file) => count + file.edits.length, 0),
    }
  }

  async apply(preview: WorkspaceEditPreview): Promise<void> {
    await this.preflight(preview.files, "before", "diskVersion")
    const closedApplied: AppliedFile[] = []
    const openApplied: AppliedFile[] = []
    try {
      for (const file of preview.files) {
        if (file.open) continue
        const result = await this.dependencies.writeTextFile(file.uri, file.after, {
          expectedVersion: file.diskVersion!,
        })
        closedApplied.push({ ...file, afterDiskVersion: result.version })
      }
      for (const file of preview.files) {
        if (!file.open) continue
        const document = this.dependencies.getOpenDocument(file.uri)
        if (!document || document.readText() !== file.before) {
          throw new WorkspaceEditConflictError(file.uri)
        }
        openApplied.push({ ...file, afterDiskVersion: null })
        document.applyEdits(file.edits)
        if (document.readText() !== file.after) {
          throw new Error(`Open document adapter did not apply edits for ${file.uri}`)
        }
      }
    } catch (error) {
      await this.rollbackOpen(openApplied, "before")
      await this.rollbackClosed(closedApplied, "afterDiskVersion", "before")
      throw error
    }
    const byUri = new Map<string, AppliedFile>()
    for (const file of closedApplied) byUri.set(file.uri, file)
    for (const file of openApplied) byUri.set(file.uri, file)
    this.lastApplied = preview.files.length > 0
      ? preview.files.map(file => byUri.get(file.uri)!)
      : null
  }

  async undoLast(): Promise<boolean> {
    const applied = this.lastApplied
    if (!applied) return false
    await this.preflight(applied, "after", "afterDiskVersion")
    const closedUndone: AppliedFile[] = []
    const openUndone: AppliedFile[] = []
    try {
      for (const file of applied) {
        if (file.open) continue
        const result = await this.dependencies.writeTextFile(file.uri, file.before, {
          expectedVersion: file.afterDiskVersion!,
        })
        closedUndone.push({ ...file, diskVersion: result.version })
      }
      for (const file of applied) {
        if (!file.open) continue
        const document = this.dependencies.getOpenDocument(file.uri)
        if (!document || document.readText() !== file.after) {
          throw new WorkspaceEditConflictError(file.uri)
        }
        if (document.undoLastEdit) await document.undoLastEdit()
        else document.applyEdits([fullDocumentEdit(file.after, file.before)])
        if (document.readText() !== file.before) {
          throw new WorkspaceEditConflictError(
            file.uri,
            `Open document could not undo the workspace edit: ${file.uri}`,
          )
        }
        openUndone.push(file)
      }
    } catch (error) {
      await this.rollbackOpen(openUndone, "after")
      for (const file of [...closedUndone].reverse()) {
        await this.dependencies.writeTextFile(file.uri, file.after, {
          expectedVersion: file.diskVersion!,
        })
      }
      throw error
    }
    this.lastApplied = null
    return true
  }

  private async preflight(
    files: readonly AppliedFile[] | readonly WorkspaceEditPreviewFile[],
    contentKey: "before" | "after",
    versionKey: "diskVersion" | "afterDiskVersion",
  ): Promise<void> {
    await Promise.all(files.map(async file => {
      const document = this.dependencies.getOpenDocument(file.uri)
      if (file.open) {
        if (!document || document.readText() !== file[contentKey]) {
          throw new WorkspaceEditConflictError(file.uri)
        }
        return
      }
      if (document) throw new WorkspaceEditConflictError(file.uri)
      const disk = await this.dependencies.readTextFile(file.uri)
      const expectedVersion = versionKey === "afterDiskVersion"
        ? (file as AppliedFile).afterDiskVersion
        : file.diskVersion
      if (disk.version !== expectedVersion || disk.content !== file[contentKey]) {
        throw new WorkspaceEditConflictError(file.uri)
      }
    }))
  }

  private async rollbackOpen(
    files: readonly AppliedFile[],
    to: "before" | "after",
  ): Promise<void> {
    for (const file of [...files].reverse()) {
      const document = this.dependencies.getOpenDocument(file.uri)
      if (!document) continue
      const current = document.readText()
      if (to === "before" && document.undoLastEdit && current !== file.before) {
        await document.undoLastEdit()
      } else {
        document.applyEdits([fullDocumentEdit(current, file[to])])
      }
    }
  }

  private async rollbackClosed(
    files: readonly AppliedFile[],
    versionKey: "diskVersion" | "afterDiskVersion",
    contentKey: "before" | "after",
  ): Promise<void> {
    for (const file of [...files].reverse()) {
      await this.dependencies.writeTextFile(file.uri, file[contentKey], {
        expectedVersion: file[versionKey]!,
      })
    }
  }
}

export function searchReplaceRequests(
  rootUri: string,
  results: readonly ProjectSearchResult[],
  replacement: string,
): WorkspaceTextEditRequest[] {
  const rootPath = fileUriToPath(rootUri).replace(/[/\\]+$/, "")
  const grouped = new Map<string, WorkspaceTextEdit[]>()
  for (const result of results) {
    const relativePath = result.path.replace(/^[/\\]+/, "")
    const uri = pathToFileUri(`${rootPath}/${relativePath}`)
    const edits = grouped.get(uri) ?? []
    for (const range of result.ranges) edits.push({ range, text: replacement })
    grouped.set(uri, edits)
  }
  return [...grouped].map(([uri, edits]) => ({ uri, edits }))
}
