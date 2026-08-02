import type {
  GitCommit,
  GitRepositorySummary,
  GitStatusEntry,
  PanelId,
  PanelView,
  ProjectSearchResult,
} from "@gharargah/shared"

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
  /** Persist a browser File blob under OS temp; returns absolute path for PTY paste. */
  writeTempDrop?(name: string, contentBase64: string): Promise<string>
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
    serverId: string,
  ): Promise<{ transportUrl: string; id: string; error?: string }>
  stop(id: string): Promise<void>
  onCrashed(cb: (id: string) => void): () => void
}

export type JetElectronTerminal = {
  create(
    cwdUri: string,
    launch?: {
      command?: string
      args?: string[]
      env?: Record<string, string>
      cols?: number
      rows?: number
    },
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
  writeBinary(id: string, dataBase64: string): Promise<void>
  resize(id: string, cols: number, rows: number): Promise<void>
  /**
   * Acknowledge that `charCount` chars from `terminal:data` have been parsed
   * by xterm. Host uses this for PTY pause/resume flow control.
   */
  acknowledgeData(id: string, charCount: number): Promise<void>
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

export type JetElectronGit = {
  isRepo(rootUri: string): Promise<boolean>
  status(rootUri: string): Promise<GitStatusEntry[]>
  diff(rootUri: string, opts?: { path?: string; staged?: boolean }): Promise<string>
  show(rootUri: string, path: string, ref: "HEAD" | "INDEX"): Promise<string>
  branch(rootUri: string): Promise<string | null>
  summary(rootUri: string): Promise<GitRepositorySummary>
  branches(rootUri: string): Promise<string[]>
  stage(rootUri: string, paths: string[]): Promise<void>
  unstage(rootUri: string, paths: string[]): Promise<void>
  discard(rootUri: string, paths: string[]): Promise<void>
  commit(rootUri: string, summary: string, body?: string): Promise<void>
  checkout(rootUri: string, branch: string): Promise<void>
  fetch(rootUri: string): Promise<void>
  pull(rootUri: string): Promise<void>
  push(rootUri: string): Promise<void>
  history(rootUri: string, limit?: number): Promise<GitCommit[]>
}

export type OpenInAppId =
  | "vscode"
  | "cursor"
  | "emacs"
  | "sublime"
  | "zed"
  | "finder"
  | "terminal"
  | "kitty"
  | "ghostty"
  | "xcode"
  | "intellij"

export type JetElectronShell = {
  openInApp(appId: OpenInAppId, rootUri: string): Promise<{ ok: boolean }>
  revealInFolder(rootUri: string): Promise<{ ok: boolean }>
}

export type JetElectronNotifications = {
  list(
    req?: import("@gharargah/shared").ListNotificationsRequest,
  ): Promise<import("@gharargah/shared").ListNotificationsResponse>
  counts(): Promise<import("@gharargah/shared").NotificationCounts>
  get(id: string): Promise<import("@gharargah/shared").AppNotification | null>
  ingest(
    req: import("@gharargah/shared").IngestNotificationRequest,
  ): Promise<{
    notification: import("@gharargah/shared").AppNotification | null
    created: boolean
    updated: boolean
    deduped: boolean
    skipped: boolean
    skipReason?: string
  }>
  markRead(id: string): Promise<import("@gharargah/shared").AppNotification | null>
  markUnread(id: string): Promise<import("@gharargah/shared").AppNotification | null>
  dismiss(id: string): Promise<import("@gharargah/shared").AppNotification | null>
  restore(id: string): Promise<import("@gharargah/shared").AppNotification | null>
  acknowledge(id: string): Promise<import("@gharargah/shared").AppNotification | null>
  markAllRead(
    req?: import("@gharargah/shared").MarkAllNotificationsReadRequest,
  ): Promise<import("@gharargah/shared").NotificationCounts>
  unreadBySession(): Promise<Record<string, number>>
  markSessionUnread(
    sessionId: string,
  ): Promise<import("@gharargah/shared").AppNotification | null>
  getPreferences(): Promise<import("@gharargah/shared").NotificationPreferences>
  setPreferences(
    prefs: Partial<import("@gharargah/shared").NotificationPreferences>,
  ): Promise<import("@gharargah/shared").NotificationPreferences>
  bindSession(
    req: import("@gharargah/shared").BindNotificationSessionRequest,
  ): Promise<{ ok: boolean }>
  onEvent(
    callback: (event: import("@gharargah/shared").NotificationStreamEvent) => void,
  ): () => void
}

export type JetElectronAgents = {
  listCliSessions(
    req: {
      provider: import("@gharargah/shared").AgentCliHistoryProvider
      cwd: string
      limit?: number
    },
    signal?: AbortSignal,
  ): Promise<import("@gharargah/shared").AgentCliHistoryResult>
  getSnapshot(
    sessionId: string,
  ): Promise<import("@gharargah/agents").AgentSessionSnapshot | null>
  listEvents(
    sessionId: string,
    opts?: { limit?: number; before?: string },
  ): Promise<import("@gharargah/agents").AgentEvent[]>
  ingestNative(req: {
    provider: string
    sessionId: string
    payload: unknown
    processId?: string
    projectId?: string
    focusedSessionId?: string | null
    appFocused?: boolean
  }): Promise<{
    eventCount: number
    snapshot: import("@gharargah/agents").AgentSessionSnapshot | null
    nativeSessionId: string | null
  }>
  installProjectHooks(req: {
    provider: string
    projectRoot: string
  }): Promise<{ written: string[] }>
  onEvent(
    callback: (event: {
      type: "agents.snapshot" | "agents.event"
      sessionId: string
      snapshot?: import("@gharargah/agents").AgentSessionSnapshot
      nativeSessionId?: string
      event?: import("@gharargah/agents").AgentEvent
    }) => void,
  ): () => void
}

export type GharargahHostAPI = {
  fs: JetElectronFS
  search: JetElectronSearch
  lsp: JetElectronLSP
  terminal?: JetElectronTerminal
  tasks?: JetElectronTasks
  workspace?: JetElectronWorkspace
  git?: JetElectronGit
  shell?: JetElectronShell
  notifications?: JetElectronNotifications
  agents?: JetElectronAgents
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
