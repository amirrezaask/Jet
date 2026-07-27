import type { AgentFileReference } from "@gharargah/agents"
import { pathToFileUri } from "@gharargah/shared"
import { setPendingEditorNavigation } from "@gharargah/monaco/pending"
import { isPathUnderRoot, resolvePathUnderRoot } from "./path-utils.js"

export { isPathUnderRoot, resolvePathUnderRoot } from "./path-utils.js"

export type OpenFileInEditor = (
  uri: string,
  path: string,
  line?: number,
  column?: number,
  endLine?: number,
  endColumn?: number,
) => void

export function openAgentFileReference(
  openFileInEditor: OpenFileInEditor,
  workspaceRootPath: string,
  ref: AgentFileReference,
): void {
  const fullPath = resolvePathUnderRoot(workspaceRootPath, ref.path)
  if (!isPathUnderRoot(workspaceRootPath, fullPath)) return
  const uri = pathToFileUri(fullPath)
  if (ref.line != null) {
    setPendingEditorNavigation(uri, {
      line: ref.line,
      column: ref.column ?? 1,
      endLine: ref.endLine,
      endColumn: ref.endColumn,
    })
  }
  openFileInEditor(
    uri,
    fullPath,
    ref.line,
    ref.column,
    ref.endLine,
    ref.endColumn,
  )
}

export function openPathFromTerminal(
  openFileInEditor: OpenFileInEditor,
  cwdRootPath: string,
  rawPath: string,
  line?: number,
  column?: number,
): string | null {
  const fullPath = resolvePathUnderRoot(cwdRootPath, rawPath)
  if (!isPathUnderRoot(cwdRootPath, fullPath)) return null
  const uri = pathToFileUri(fullPath)
  if (line != null) {
    setPendingEditorNavigation(uri, { line, column: column ?? 1 })
  }
  openFileInEditor(uri, fullPath, line, column)
  return fullPath
}

/** Open a path in the Git DiffEditor surface (agent / review). */
export function openDiff(
  switchToGit: (relativeOrAbsolutePath: string) => void,
  path: string,
): void {
  switchToGit(path)
}
