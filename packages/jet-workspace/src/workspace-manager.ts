import { basename, Emitter, fileUriToPath, languageIdFromPath, pathToFileUri } from "@jet/shared"
import { AgentSessionStore } from "./agent-session-store.js"
import type { WorkspaceEntry, WorkspaceFile, WorkspaceRoot } from "./types.js"
import type { FileSystemProvider } from "./types.js"

export type WorkspaceFolder = {
  id: string
  root: WorkspaceRoot
}

export type ConfirmDiscardReloadFn = (fileName: string) => Promise<boolean>

function normalizeAbsPath(p: string): string {
  return p.replace(/[/\\]+$/, "") || p
}

function isPathUnderRoot(filePath: string, rootPath: string): boolean {
  const normFile = normalizeAbsPath(filePath)
  const normRoot = normalizeAbsPath(rootPath)
  if (normFile === normRoot) return true
  const sep = normRoot.includes("\\") ? "\\" : "/"
  return normFile.startsWith(`${normRoot}${sep}`)
}

function newFolderId(): string {
  return crypto.randomUUID()
}

export class WorkspaceFolderState {
  readonly id: string
  readonly root: WorkspaceRoot
  confirmDiscardReload: ConfirmDiscardReloadFn | null = null

  private files = new Map<string, WorkspaceFile>()
  private savedBaseline = new Map<string, string>()
  private recentWrites = new Map<string, number>()
  untitledCounter = 1

  readonly agents = new AgentSessionStore()
  readonly onDidOpenFile = new Emitter<WorkspaceFile>()
  readonly onDidChangeDirty = new Emitter<{ uri: string; isDirty: boolean }>()
  readonly onDidChangeSavedBaseline = new Emitter<{ uri: string; content: string }>()
  readonly onFileReload = new Emitter<{ uri: string; content: string }>()

  constructor(id: string, root: WorkspaceRoot, private fs: FileSystemProvider) {
    this.id = id
    this.root = root
  }

  fileForUri(uri: string): WorkspaceFile | undefined {
    return this.files.get(uri)
  }

  registerFile(file: WorkspaceFile): void {
    this.files.set(file.uri, file)
  }

  allFiles(): Iterable<WorkspaceFile> {
    return this.files.values()
  }

  hasDirtyFiles(): boolean {
    for (const file of this.files.values()) {
      if (file.isDirty) return true
    }
    return false
  }

  clear(): void {
    this.files.clear()
    this.savedBaseline.clear()
    this.recentWrites.clear()
    this.untitledCounter = 1
    this.agents.disposeAll()
  }

  markDirty(uri: string, isDirty: boolean): void {
    const file = this.files.get(uri)
    if (!file || file.isDirty === isDirty) return
    file.isDirty = isDirty
    this.onDidChangeDirty.fire({ uri, isDirty })
  }

  setSavedBaseline(uri: string, content: string): void {
    this.savedBaseline.set(uri, content)
    this.onDidChangeSavedBaseline.fire({ uri, content })
    this.syncDirtyFromDoc(uri, content)
  }

  savedBaselineFor(uri: string): string | undefined {
    return this.savedBaseline.get(uri)
  }

  syncDirtyFromDoc(uri: string, content: string): void {
    if (!this.savedBaseline.has(uri)) return
    const baseline = this.savedBaseline.get(uri)!
    this.markDirty(uri, content !== baseline)
  }

  private isRecentlyWritten(uri: string, ttlMs = 2500): boolean {
    const wroteAt = this.recentWrites.get(uri)
    if (wroteAt == null) return false
    if (Date.now() - wroteAt > ttlMs) {
      this.recentWrites.delete(uri)
      return false
    }
    return true
  }

  clearDirtyState(uri: string): void {
    this.markDirty(uri, false)
  }

  async readFile(uri: string): Promise<string> {
    return this.fs.readFile(uri)
  }

  async writeFile(uri: string, content: string): Promise<void> {
    await this.fs.writeFile(uri, content)
    this.recentWrites.set(uri, Date.now())
    this.setSavedBaseline(uri, content)
  }

  async reloadFileFromDisk(uri: string, opts?: { force?: boolean }): Promise<string | null> {
    const file = this.files.get(uri)
    if (!file) return null
    if (file.isDirty && !opts?.force) return null
    try {
      const content = await this.fs.readFile(uri)
      this.setSavedBaseline(uri, content)
      this.onFileReload.fire({ uri, content })
      return content
    } catch {
      return null
    }
  }

  async handleExternalFileChange(uri: string): Promise<void> {
    const file = this.files.get(uri)
    if (!file) return
    if (this.isRecentlyWritten(uri)) return
    if (file.isDirty) {
      const ok = this.confirmDiscardReload
        ? await this.confirmDiscardReload(file.name)
        : false
      if (ok) void this.reloadFileFromDisk(uri, { force: true })
      return
    }
    void this.reloadFileFromDisk(uri)
  }

  async readDir(uri: string): Promise<WorkspaceEntry[]> {
    return this.fs.readDir(uri)
  }

  createWorkspaceFile(uri: string, path: string, languageId?: string): WorkspaceFile {
    const file: WorkspaceFile = {
      uri,
      path,
      name: basename(path),
      languageId: languageId ?? languageIdFromPath(path),
      isDirty: false,
    }
    this.registerFile(file)
    return file
  }

  containsUri(uri: string): boolean {
    if (uri.startsWith("untitled:")) return false
    const path = fileUriToPath(uri)
    return isPathUnderRoot(path, this.root.path)
  }

  containsPath(path: string): boolean {
    return isPathUnderRoot(path, this.root.path)
  }
}

type FolderEntry = {
  folder: WorkspaceFolder
  state: WorkspaceFolderState
}

export class WorkspaceManager {
  private entries: FolderEntry[] = []
  private activeFolderId: string | null = null

  readonly onDidChangeFolders = new Emitter<WorkspaceFolder[]>()
  readonly onDidChangeActiveFolder = new Emitter<WorkspaceFolder | null>()
  readonly onDidAddFolder = new Emitter<WorkspaceFolder>()

  constructor(private fs: FileSystemProvider) {}

  get folders(): WorkspaceFolder[] {
    return this.entries.map(e => e.folder)
  }

  get activeFolder(): WorkspaceFolder | null {
    if (!this.activeFolderId) return null
    return this.entries.find(e => e.folder.id === this.activeFolderId)?.folder ?? null
  }

  get activeFolderState(): WorkspaceFolderState | null {
    if (!this.activeFolderId) return null
    return this.entries.find(e => e.folder.id === this.activeFolderId)?.state ?? null
  }

  hasFolders(): boolean {
    return this.entries.length > 0
  }

  folderStateForId(id: string): WorkspaceFolderState | undefined {
    return this.entries.find(e => e.folder.id === id)?.state
  }

  folderStateForUri(uri: string): WorkspaceFolderState | undefined {
    for (const entry of this.entries) {
      if (entry.state.containsUri(uri)) return entry.state
    }
    return undefined
  }

  folderStateForPath(path: string): WorkspaceFolderState | undefined {
    const norm = normalizeAbsPath(path)
    for (const entry of this.entries) {
      if (normalizeAbsPath(entry.folder.root.path) === norm) return entry.state
    }
    for (const entry of this.entries) {
      if (entry.state.containsPath(path)) return entry.state
    }
    return undefined
  }

  allFolderStates(): WorkspaceFolderState[] {
    return this.entries.map(e => e.state)
  }

  async addFolder(folderPath: string): Promise<WorkspaceFolder> {
    const norm = normalizeAbsPath(folderPath)
    const existing = this.entries.find(
      e => normalizeAbsPath(e.folder.root.path) === norm,
    )
    if (existing) {
      this.setActiveFolder(existing.folder.id)
      return existing.folder
    }

    const uri = pathToFileUri(folderPath)
    const id = newFolderId()
    const root: WorkspaceRoot = { uri, path: folderPath, name: basename(folderPath) }
    const folder: WorkspaceFolder = { id, root }
    const state = new WorkspaceFolderState(id, root, this.fs)
    this.entries.push({ folder, state })
    this.activeFolderId = id
    this.onDidAddFolder.fire(folder)
    this.onDidChangeFolders.fire(this.folders)
    this.onDidChangeActiveFolder.fire(folder)
    return folder
  }

  async replaceAllFolders(folderPath: string): Promise<WorkspaceFolder> {
    this.clearAllFolders()
    return this.addFolder(folderPath)
  }

  clearAllFolders(): void {
    for (const entry of this.entries) {
      entry.state.clear()
    }
    this.entries = []
    this.activeFolderId = null
    this.onDidChangeFolders.fire(this.folders)
    this.onDidChangeActiveFolder.fire(null)
  }

  removeFolder(id: string): boolean {
    const idx = this.entries.findIndex(e => e.folder.id === id)
    if (idx < 0) return false
    const entry = this.entries[idx]!
    if (entry.state.hasDirtyFiles()) return false
    entry.state.clear()
    this.entries.splice(idx, 1)
    if (this.activeFolderId === id) {
      this.activeFolderId = this.entries[0]?.folder.id ?? null
      this.onDidChangeActiveFolder.fire(this.activeFolder ?? null)
    }
    this.onDidChangeFolders.fire(this.folders)
    return true
  }

  setActiveFolder(id: string): void {
    if (!this.entries.some(e => e.folder.id === id)) return
    if (this.activeFolderId === id) return
    this.activeFolderId = id
    this.onDidChangeActiveFolder.fire(this.activeFolder)
  }

  async readDir(uri: string): Promise<WorkspaceEntry[]> {
    for (const entry of this.entries) {
      if (entry.folder.root.uri === uri) {
        return entry.state.readDir(uri)
      }
    }
    const folderState = this.folderStateForUri(uri)
    if (folderState) return folderState.readDir(uri)
    return this.fs.readDir(uri)
  }

  readFile(uri: string): Promise<string> {
    return this.fs.readFile(uri)
  }
}

export { normalizeAbsPath, isPathUnderRoot }
