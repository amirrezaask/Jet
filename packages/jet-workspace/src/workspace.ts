import { basename, Emitter, languageIdFromPath, pathToFileUri } from "@jet/shared"
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
    this.metas.set(tabId.id, { ...current, ...patch })
    this.onDidChange.fire()
  }

  delete(tabId: TabId): void {
    this.kinds.delete(tabId.id)
    this.metas.delete(tabId.id)
    this.panelByTab.delete(tabId.id)
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
  readonly tabRegistry = new TabRegistry()
  readonly onDidOpenFile = new Emitter<WorkspaceFile>()
  readonly onDidChangeDirty = new Emitter<{ uri: string; isDirty: boolean }>()
  readonly onDidOpenWorkspace = new Emitter<WorkspaceRoot>()

  constructor(private fs: FileSystemProvider) {}

  async openWorkspace(folderPath: string): Promise<void> {
    const uri = pathToFileUri(folderPath)
    this.root = { uri, path: folderPath, name: basename(folderPath) }
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
    if (!file) return
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

  async readFile(uri: string): Promise<string> {
    return this.fs.readFile(uri)
  }

  async writeFile(uri: string, content: string): Promise<void> {
    await this.fs.writeFile(uri, content)
    this.markDirty(uri, false)
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

  openEditorTab(tree: PanelTree, panelId: PanelId, uri: string, path: string): TabId {
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

  ensureSingletonTab(
    tree: PanelTree,
    panelId: PanelId,
    kind: Extract<TabKind, { kind: "explorer" | "git" | "terminal" }>,
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
