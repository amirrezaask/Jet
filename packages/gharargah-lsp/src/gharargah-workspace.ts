import { canonicalizeFileUri } from "@gharargah/shared"

/** Workspace integration hooks used by the Monaco LSP client pool. */
export type JetLspWorkspaceDeps = {
  openFile: (uri: string, path: string, line?: number, column?: number) => void
  pushJumpLocation?: (uri: string, line: number, column: number) => void
  readFile: (uri: string) => Promise<string>
  getLanguageId: (uri: string) => string
  isDirty: (uri: string) => boolean
  getContent: (uri: string) => string | undefined
  updateContent: (uri: string, content: string) => void
  writeFile: (uri: string, content: string) => Promise<void>
}

const documentVersions = new Map<string, number>()

export function bumpDocumentVersion(uri: string): number {
  const key = canonicalizeFileUri(uri)
  const next = (documentVersions.get(key) ?? -1) + 1
  documentVersions.set(key, next)
  return next
}

export function getDocumentVersion(uri: string): number | undefined {
  return documentVersions.get(canonicalizeFileUri(uri))
}
