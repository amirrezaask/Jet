import { basename, Emitter, languageIdFromPath, pathToFileUri, makeUntitledUri } from "@jet/shared"
import type { PanelId, TabId } from "@jet/shared"
import type { PanelTree } from "@jet/panels"
import type { TabKind, TabMeta, WorkspaceFile, WorkspaceRoot } from "./types.js"
import type { FileSystemProvider } from "./types.js"

export class TabRegistry {
  private kinds = new Map<number, TabKind>()
  private metas = new Map<number, TabMeta>()
  private panelByTab = new Map<number, PanelId>()

  readonly onDidChange = new Emitter<void>()

  set(tabId: TabId, kind: TabKind, meta: TabMeta, panelId?: PanelId): void {
    this.kinds.set(tabId.id, kind)
    this.metas.set(tabId.id, meta)
    if (panelId) this.panelByTab.set(tabId.id, panelId)
    this.onDidChange.fire()
  }

  get(tabId: TabId): TabKind | undefined {
    return this.kinds.get(tabId.id)
  }

  meta(tabId: TabId): TabMeta {
    return this.metas.get(tabId.id) ?? { label: "Tab", closeable: true }
  }

  updateMeta(tabId: TabId, patch: Partial<TabMeta>): void {
    const current = this.meta(tabId)
    let changed = false
    for (const key of Object.keys(patch) as (keyof TabMeta)[]) {
      if (current[key] !== patch[key]) {
        changed = true
        break
      }
    }
    if (!changed) return
    this.metas.set(tabId.id, { ...current, ...patch })
    this.onDidChange.fire()
  }

  delete(tabId: TabId): void {
    this.kinds.delete(tabId.id)
    this.metas.delete(tabId.id)
    this.panelByTab.delete(tabId.id)
    this.onDidChange.fire()
  }

  clear(): void {
    this.kinds.clear()
    this.metas.clear()
    this.panelByTab.clear()
    this.onDidChange.fire()
  }

  panelForTab(tabId: TabId): PanelId | undefined {
    return this.panelByTab.get(tabId.id)
  }

  setPanel(tabId: TabId, panelId: PanelId): void {
    this.panelByTab.set(tabId.id, panelId)
  }

  allTabs(): TabId[] {
    return [...this.kinds.keys()].map(id => ({ id }))
  }
}

export class WorkspaceService {
  root: WorkspaceRoot | null = null
  private files = new Map<string, WorkspaceFile>()
  private savedBaseline = new Map<string, string>()
  private recentWrites = new Map<string, number>()
  private untitledCounter = 1
  readonly tabRegistry = new TabRegistry()
  readonly onDidOpenFile = new Emitter<WorkspaceFile>()
  readonly onDidChangeDirty = new Emitter<{ uri: string; isDirty: boolean }>()
  readonly onDidOpenWorkspace = new Emitter<WorkspaceRoot>()
  readonly onFileReload = new Emitter<{ uri: string; content: string }>()

  constructor(private fs: FileSystemProvider) {}

  async openWorkspace(folderPath: string): Promise<void> {
    const uri = pathToFileUri(folderPath)
    this.root = { uri, path: folderPath, name: basename(folderPath) }
    this.files.clear()
    this.savedBaseline.clear()
    this.recentWrites.clear()
    this.onDidOpenWorkspace.fire(this.root)
  }

  fileForUri(uri: string): WorkspaceFile | undefined {
    return this.files.get(uri)
  }

  registerFile(file: WorkspaceFile): void {
    this.files.set(file.uri, file)
  }

  markDirty(uri: string, isDirty: boolean): void {
    const file = this.files.get(uri)
    if (!file || file.isDirty === isDirty) return
    file.isDirty = isDirty
    this.onDidChangeDirty.fire({ uri, isDirty })
    const tabs = this.tabRegistry.allTabs()
    for (const tabId of tabs) {
      const kind = this.tabRegistry.get(tabId)
      if (kind?.kind === "editor" && kind.fileUri === uri) {
        this.tabRegistry.updateMeta(tabId, { dirty: isDirty })
      }
    }
  }

  setSavedBaseline(uri: string, content: string): void {
    this.savedBaseline.set(uri, content)
    this.syncDirtyFromDoc(uri, content)
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

  handleExternalFileChange(uri: string): void {
    const file = this.files.get(uri)
    if (!file) return
    if (this.isRecentlyWritten(uri)) return
    if (file.isDirty) {
      if (window.confirm(`"${file.name}" changed on disk. Reload and discard local changes?`)) {
        void this.reloadFileFromDisk(uri, { force: true })
      }
      return
    }
    void this.reloadFileFromDisk(uri)
  }

  async readDir(uri: string) {
    return this.fs.readDir(uri)
  }

  createWorkspaceFile(uri: string, path: string): WorkspaceFile {
    const file: WorkspaceFile = {
      uri,
      path,
      name: basename(path),
      languageId: languageIdFromPath(path),
      isDirty: false,
    }
    this.registerFile(file)
    return file
  }

  findEditorTab(uri: string): TabId | undefined {
    for (const tabId of this.tabRegistry.allTabs()) {
      const kind = this.tabRegistry.get(tabId)
      if (kind?.kind === "editor" && kind.fileUri === uri) return tabId
    }
    return undefined
  }

  openEditorTab(tree: PanelTree, panelId: PanelId, uri: string, path: string): TabId {
    const existing = this.findEditorTab(uri)
    if (existing) {
      const existingPanel = this.tabRegistry.panelForTab(existing) ?? tree.findPanelForTab(existing)
      if (existingPanel) {
        tree.setActiveTab(existingPanel, existing)
        this.tabRegistry.setPanel(existing, existingPanel)
      } else {
        tree.insertTab(panelId, existing)
        this.tabRegistry.setPanel(existing, panelId)
      }
      return existing
    }

    let file = this.files.get(uri)
    if (!file) file = this.createWorkspaceFile(uri, path)
    const tabId = tree.allocTabId()
    tree.insertTab(panelId, tabId)
    this.tabRegistry.set(
      tabId,
      { kind: "editor", fileUri: uri },
      { label: file.name, dirty: file.isDirty, closeable: true },
      panelId,
    )
    this.onDidOpenFile.fire(file)
    return tabId
  }

  openUntitledTab(
    tree: PanelTree,
    panelId: PanelId,
    opts?: { label?: string; languageId?: string },
  ): TabId {
    const n = this.untitledCounter++
    const uri = makeUntitledUri(n)
    const label = opts?.label ?? `Untitled-${n}`
    const languageId = opts?.languageId ?? (opts?.label ? languageIdFromPath(opts.label) : "plaintext")
    const file: WorkspaceFile = {
      uri,
      path: "",
      name: label,
      languageId,
      isDirty: false,
    }
    this.registerFile(file)
    const tabId = tree.allocTabId()
    tree.insertTab(panelId, tabId)
    this.tabRegistry.set(
      tabId,
      { kind: "editor", fileUri: uri },
      { label, dirty: false, closeable: true },
      panelId,
    )
    this.onDidOpenFile.fire(file)
    return tabId
  }

  promoteUntitledTab(tabId: TabId, fileUri: string, path: string): void {
    const kind = this.tabRegistry.get(tabId)
    if (kind?.kind !== "editor") return
    this.files.delete(kind.fileUri)
    const file = this.createWorkspaceFile(fileUri, path)
    const panel = this.tabRegistry.panelForTab(tabId)
    this.tabRegistry.set(
      tabId,
      { kind: "editor", fileUri },
      { label: file.name, dirty: false, closeable: true },
      panel,
    )
  }

  ensureSingletonTab(
    tree: PanelTree,
    panelId: PanelId,
    kind: Extract<TabKind, { kind: "explorer" | "git" | "terminal" | "search" | "problems" }>,
    label: string,
    existingTabId: TabId | null,
  ): TabId {
    if (existingTabId) {
      tree.setActiveTab(panelId, existingTabId)
      return existingTabId
    }
    const tabId = tree.allocTabId()
    tree.insertTab(panelId, tabId)
    this.tabRegistry.set(tabId, kind, { label, closeable: kind.kind !== "explorer" }, panelId)
    return tabId
  }
}
