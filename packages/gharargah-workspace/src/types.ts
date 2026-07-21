import type { PanelId, PanelView, ProjectSearchResult } from "@gharargah/shared"
import type {
  AgentThread,
  AgentThreadDelta,
  AgentWorkspaceSnapshot,
  AgentProvidersState,
  CreateAgentThreadInput,
  InterruptAgentTurnInput,
  SendAgentMessageInput,
  SetAgentThreadArchivedInput,
  UpdateAgentThreadSettingsInput,
} from "@gharargah/agents"

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
  create(
    cwdUri: string,
    launch?: { command: string; args?: string[] },
  ): Promise<{ id: string; title?: string }>
  attach(id: string): Promise<{
    id: string
    title?: string
    output: string
    lastSequence: number
    status: "running" | "exited"
    exitCode?: number
    signal?: number
  } | null>
  write(id: string, data: string): Promise<void>
  resize(id: string, cols: number, rows: number): Promise<void>
  onData(id: string, callback: (data: string) => void): () => void
  onExit(cb: (id: string, exitCode: number, signal?: number) => void): () => void
  dispose(id: string): Promise<void>
}

export type LaunchConfig = {
  workspacePath: string
  filePath?: string
  source?: "default" | "explicit" | "external"
}

export type JetElectronWorkspace = {
  activate(rootUri: string): Promise<{ ok: boolean }>
  deactivate?(rootUri: string): Promise<{ ok: boolean }>
  onFileIndex(callback: (rootUri: string, files: string[]) => void): () => void
  onSearchReady?(callback: (rootUri: string) => void): () => void
}

export type JetElectronAgents = {
  listThreads(
    workspaceRootUri: string,
    workspaceRootPath: string,
  ): Promise<AgentWorkspaceSnapshot>
  readThread(
    workspaceRootUri: string,
    workspaceRootPath: string,
    threadId: string,
  ): Promise<AgentThread | null>
  createThread(input: CreateAgentThreadInput): Promise<AgentThread>
  sendMessage(input: SendAgentMessageInput): Promise<AgentThread>
  interruptTurn(input: InterruptAgentTurnInput): Promise<AgentThread | null>
  setArchived(input: SetAgentThreadArchivedInput): Promise<AgentThread | null>
  updateThreadSettings(input: UpdateAgentThreadSettingsInput): Promise<AgentThread | null>
  listProviders(): Promise<AgentProvidersState>
  refreshProviders(): Promise<AgentProvidersState>
  onThreadUpdated?(callback: (thread: AgentThread) => void): () => void
  onThreadDelta?(callback: (delta: AgentThreadDelta) => void): () => void
}

export type JetElectronGit = {
  branch(rootUri: string): Promise<string | null>
}

export type OpenInAppId = "vscode" | "sublime" | "cursor" | "ghostty" | "kitty"

export type JetElectronShell = {
  openInApp(appId: OpenInAppId, rootUri: string): Promise<{ ok: boolean }>
}

export type GharargahHostAPI = {
  fs: JetElectronFS
  search: JetElectronSearch
  lsp: JetElectronLSP
  terminal?: JetElectronTerminal
  tasks?: JetElectronTasks
  workspace?: JetElectronWorkspace
  agents?: JetElectronAgents
  git?: JetElectronGit
  shell?: JetElectronShell
  getLaunchConfig?(): Promise<LaunchConfig | null>
  getHomeDir?(): Promise<string>
  loadGlobalGharargahrcScanRoots?(): Promise<string[]>
  onLaunch?(cb: (config: LaunchConfig) => void): () => void
  syncNativeChrome?(colors: { background: string; foreground: string }): Promise<void>
  recordStartup?(record: Record<string, unknown>): Promise<string>
  getStartupLogPath?(): Promise<string>
}

declare global {
  interface Window {
    gharargah?: GharargahHostAPI
  }
}

export type PanelViewKind = PanelView["kind"]
