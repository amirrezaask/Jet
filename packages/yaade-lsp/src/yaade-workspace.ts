import { canonicalizeFileUri } from "@yaade/shared"
import type {
  MessageActionItem,
  ShowDocumentParams,
  ShowMessageRequestParams,
  WorkspaceEdit,
} from "vscode-languageserver-protocol"
import type { WorkspaceFileChange } from "./watched-files.js"

export type LspOutputEntry = {
  connectionId: string
  timestamp: number
  direction: "client" | "server"
  method: string
  kind: "request" | "notification" | "response" | "error"
  message?: string
  data?: unknown
}

export type LspProgressEvent = {
  connectionId: string
  token: string | number
  kind: "created" | "begin" | "report" | "end"
  title?: string
  message?: string
  percentage?: number
  cancellable?: boolean
}

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
  onFileChanged?: (callback: (event: WorkspaceFileChange) => void) => () => void
  showDocument?: (params: ShowDocumentParams) => Promise<boolean>
  showMessageRequest?: (
    params: ShowMessageRequestParams,
  ) => Promise<MessageActionItem | null>
  onProgress?: (event: LspProgressEvent) => void
  onOutput?: (entry: LspOutputEntry) => void
  isUriAllowed?: (uri: string) => boolean
  applyWorkspaceEditTransaction?: (
    edit: WorkspaceEdit,
    options: { allowDirty?: boolean; atomic: true },
  ) => Promise<{ applied: boolean; reason?: string }>
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
