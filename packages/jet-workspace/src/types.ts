import type { PanelId, TabId } from "@jet/shared"

export type TabKind =
  | { kind: "editor"; fileUri: string }
  | { kind: "explorer" }
  | { kind: "git" }
  | { kind: "terminal"; terminalId: string }
  | { kind: "search" }
  | { kind: "problems" }

export type TabMeta = {
  label: string
  dirty?: boolean
  closeable: boolean
}

export type WorkspaceFile = {
  uri: string
  path: string
  name: string
  languageId: string
  isDirty: boolean
}

export type WorkspaceEntry = {
  uri: string
  name: string
  isDirectory: boolean
}

export type WorkspaceStat = {
  uri: string
  isDirectory: boolean
  size: number
}

export type WorkspaceRoot = {
  uri: string
  name: string
  path: string
}

export interface FileSystemProvider {
  readFile(uri: string): Promise<string>
  writeFile(uri: string, content: string): Promise<void>
  readDir(uri: string): Promise<WorkspaceEntry[]>
  stat(uri: string): Promise<WorkspaceStat>
}

export type JetElectronFS = FileSystemProvider & {
  showOpenFolderDialog(): Promise<string | null>
}

export type JetElectronGit = {
  isRepo(rootUri: string): Promise<boolean>
  status(rootUri: string): Promise<import("@jet/shared").GitStatusEntry[]>
  diff(rootUri: string, opts?: { path?: string; staged?: boolean }): Promise<string>
}

export type JetElectronLSP = {
  start(rootUri: string, languageId: string): Promise<{ transportUrl: string; id: string }>
  stop(id: string): Promise<void>
  onCrashed(cb: (id: string) => void): () => void
}

export type JetElectronAPI = {
  fs: JetElectronFS
  git: JetElectronGit
  lsp: JetElectronLSP
}

declare global {
  interface Window {
    jet?: JetElectronAPI
  }
}
