import type { PanelId, TabId } from "@jet/shared"
import type { ProjectSearchResult } from "@jet/shared"

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
  showSaveFileDialog(defaultPath?: string): Promise<string | null>
  watchWorkspace?(rootUri: string): Promise<void>
  onFileChanged?(callback: (uri: string) => void): () => void
}

export type JetElectronGit = {
  isRepo(rootUri: string): Promise<boolean>
  status(rootUri: string): Promise<import("@jet/shared").GitStatusEntry[]>
  diff(rootUri: string, opts?: { path?: string; staged?: boolean }): Promise<string>
  branch(rootUri: string): Promise<string | null>
  stage(rootUri: string, paths: string[]): Promise<void>
  unstage(rootUri: string, paths: string[]): Promise<void>
  commit(rootUri: string, message: string): Promise<void>
  branches(rootUri: string): Promise<string[]>
  checkout(rootUri: string, branch: string): Promise<void>
}

export type JetElectronSearch = {
  project(
    rootUri: string,
    query: string,
    opts?: { caseSensitive?: boolean; regex?: boolean },
  ): Promise<ProjectSearchResult[]>
  listFiles(rootUri: string): Promise<string[]>
}

export type JetElectronTerminal = {
  create(cwd: string): Promise<{ id: string }>
  write(id: string, data: string): Promise<void>
  resize(id: string, cols: number, rows: number): Promise<void>
  onData(id: string, callback: (data: string) => void): () => void
  dispose(id: string): Promise<void>
}

export type JetElectronLSP = {
  start(
    rootUri: string,
    languageId: string,
    command?: string,
    args?: string[],
  ): Promise<{ transportUrl: string; id: string }>
  stop(id: string): Promise<void>
  onCrashed(cb: (id: string) => void): () => void
}

export type JetElectronAPI = {
  fs: JetElectronFS
  git: JetElectronGit
  search: JetElectronSearch
  lsp: JetElectronLSP
  terminal?: JetElectronTerminal
}

declare global {
  interface Window {
    jet?: JetElectronAPI
  }
}
