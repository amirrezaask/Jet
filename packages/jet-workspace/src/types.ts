import type { PanelId, PanelView, ProjectSearchResult } from "@jet/shared"

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

export type JetElectronSearch = {
  project(
    rootUri: string,
    query: string,
    opts?: { caseSensitive?: boolean; regex?: boolean; fuzzy?: boolean },
  ): Promise<ProjectSearchResult[]>
  listFiles(rootUri: string): Promise<string[]>
  fileSearch(
    rootUri: string,
    query: string,
    opts?: { pageSize?: number; currentFile?: string },
  ): Promise<string[]>
  trackFileAccess?(rootUri: string, query: string, path: string): Promise<void>
  isScanReady?(rootUri: string): Promise<boolean>
  isSupported?(rootUri: string): Promise<boolean>
}

export type JetTaskSpawnRequest = {
  id: string
  command: string
  args: string[]
  cwd: string
}

export type JetElectronTasks = {
  spawn(req: JetTaskSpawnRequest): Promise<{ exitCode: number; output: string }>
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

export type JetElectronTerminal = {
  create(cwdUri: string): Promise<{ id: string }>
  write(id: string, data: string): Promise<void>
  resize(id: string, cols: number, rows: number): Promise<void>
  onData(id: string, callback: (data: string) => void): () => void
  dispose(id: string): Promise<void>
}

export type LaunchConfig = {
  workspacePath: string
  filePath?: string
}

export type JetElectronWorkspace = {
  activate(rootUri: string): Promise<{ ok: boolean }>
  deactivate?(rootUri: string): Promise<{ ok: boolean }>
  onFileIndex(callback: (rootUri: string, files: string[]) => void): () => void
  onSearchReady?(callback: (rootUri: string) => void): () => void
}

export type JetElectronAPI = {
  fs: JetElectronFS
  search: JetElectronSearch
  lsp: JetElectronLSP
  terminal?: JetElectronTerminal
  tasks?: JetElectronTasks
  workspace?: JetElectronWorkspace
  getLaunchConfig?(): Promise<LaunchConfig | null>
  getHomeDir?(): Promise<string>
  loadGlobalJetrcScanRoots?(): Promise<string[]>
  onLaunch?(cb: (config: LaunchConfig) => void): () => void
}

declare global {
  interface Window {
    jet?: JetElectronAPI
  }
}

export type PanelViewKind = PanelView["kind"]
