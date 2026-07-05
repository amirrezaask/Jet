import { basename, Emitter, languageIdFromPath, pathToFileUri, makeUntitledUri } from "@jet/shared"
import type { PanelId, PanelView } from "@jet/shared"
import type { JetPanelTree } from "./panel-tree.js"
import type { WorkspaceFile, WorkspaceRoot } from "./types.js"
import type { FileSystemProvider } from "./types.js"
import { JumpStack } from "./jump-stack.js"
import { allocListId, ListDocumentStore, type ListDocument } from "./list-document.js"
import { TaskRunner } from "./task-runner.js"
import {
  activatePanelTab,
  buildTabsView,
  findPanelWithTab,
  panelHasTab,
  panelTabIds,
  popPanelTab,
  pushPanelTab,
} from "./panel-tabs.js"
import {
  EXPLORER_TAB_ID,
  OUTPUT_TAB_ID,
  PROBLEMS_TAB_ID,
  TabRegistry,
  type TabDescriptor,
  type TabKind,
} from "./tab-registry.js"

/** Tab kinds whose payload lives in the list store and should be disposed with the tab. */
const LIST_TAB_KINDS = new Set<string>([
  "search",
  "problems",
  "references",
  "definitions",
  "task-errors",
])

export type ConfirmDiscardReloadFn = (fileName: string) => Promise<boolean>

export class WorkspaceService {
  root: WorkspaceRoot | null = null
  confirmDiscardReload: ConfirmDiscardReloadFn | null = null
  private files = new Map<string, WorkspaceFile>()
  private savedBaseline = new Map<string, string>()
  private recentWrites = new Map<string, number>()
  private untitledCounter = 1
  openBuffers: string[] = []

  readonly jumpStack = new JumpStack()
  readonly tabRegistry = new TabRegistry()
  readonly listStore = new ListDocumentStore()
  readonly taskRunner = new TaskRunner()

  readonly onDidOpenFile = new Emitter<WorkspaceFile>()
  readonly onDidChangeDirty = new Emitter<{ uri: string; isDirty: boolean }>()
  readonly onDidChangeSavedBaseline = new Emitter<{ uri: string; content: string }>()
  readonly onDidOpenWorkspace = new Emitter<WorkspaceRoot>()
  readonly onFileReload = new Emitter<{ uri: string; content: string }>()
  readonly onDidChangeBuffers = new Emitter<void>()

  constructor(private fs: FileSystemProvider) {}

  async openWorkspace(folderPath: string): Promise<void> {
    const uri = pathToFileUri(folderPath)
    this.root = { uri, path: folderPath, name: basename(folderPath) }
    this.files.clear()
    this.savedBaseline.clear()
    this.recentWrites.clear()
    this.openBuffers = []
    this.onDidOpenWorkspace.fire(this.root)
    this.onDidChangeBuffers.fire()
  }

  fileForUri(uri: string): WorkspaceFile | undefined {
    return this.files.get(uri)
  }

  registerFile(file: WorkspaceFile): void {
    this.files.set(file.uri, file)
  }

  touchBuffer(uri: string): void {
    this.openBuffers = [uri, ...this.openBuffers.filter(u => u !== uri)]
    this.onDidChangeBuffers.fire()
  }

  closeBuffer(uri: string): void {
    this.openBuffers = this.openBuffers.filter(u => u !== uri)
    this.onDidChangeBuffers.fire()
  }

  markDirty(uri: string, isDirty: boolean): void {
    const file = this.files.get(uri)
    if (!file || file.isDirty === isDirty) return
    file.isDirty = isDirty
    this.onDidChangeDirty.fire({ uri, isDirty })
    this.tabRegistry.update(uri, { label: file.name })
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

  registerTab(tab: TabDescriptor, listDoc?: ListDocument): void {
    this.tabRegistry.register(tab)
    if (listDoc && !this.listStore.get(listDoc.id)) {
      this.listStore.create(listDoc)
    }
  }

  disposeTab(tabId: string): void {
    const kind = this.tabRegistry.kindFor(tabId)
    this.tabRegistry.dispose(tabId)
    if (kind && LIST_TAB_KINDS.has(kind)) {
      this.listStore.dispose(tabId)
    }
  }

  openTabInPanel(
    tree: JetPanelTree,
    panelId: PanelId,
    tab: TabDescriptor,
    listDoc?: ListDocument,
    opts?: { replaceTabId?: string },
  ): string {
    this.registerTab(tab, listDoc)
    if (tab.kind === "editor") {
      const file = this.files.get(tab.id) ?? this.createWorkspaceFile(tab.id, tab.label)
      this.touchBuffer(tab.id)
      this.onDidOpenFile.fire(file)
    }
    const current = tree.getView(panelId)
    tree.setView(panelId, pushPanelTab(current, tab.id, opts?.replaceTabId))
    return tab.id
  }

  focusTabInPanel(tree: JetPanelTree, panelId: PanelId, tabId: string): void {
    const view = tree.getView(panelId)
    if (view?.kind !== "tabs") return
    tree.setView(panelId, activatePanelTab(view, tabId))
  }

  openOrFocusTab(
    tree: JetPanelTree,
    panelId: PanelId,
    tab: TabDescriptor,
    listDoc?: ListDocument,
  ): { panelId: PanelId; tabId: string } {
    const existingPanel = findPanelWithTab(tree, tab.id)
    if (existingPanel) {
      this.registerTab(tab, listDoc)
      this.focusTabInPanel(tree, existingPanel, tab.id)
      return { panelId: existingPanel, tabId: tab.id }
    }
    const tabId = this.openTabInPanel(tree, panelId, tab, listDoc)
    return { panelId, tabId }
  }

  closeTabInPanel(tree: JetPanelTree, panelId: PanelId, tabId: string): void {
    const view = tree.getView(panelId)
    if (view?.kind !== "tabs") return
    tree.setView(panelId, popPanelTab(view, tabId))
  }

  assignEditorPanel(
    tree: JetPanelTree,
    panelId: PanelId,
    uri: string,
    path: string,
    opts?: { replaceUri?: string },
  ): void {
    let file = this.files.get(uri)
    if (!file) file = this.createWorkspaceFile(uri, path)
    this.openTabInPanel(
      tree,
      panelId,
      { id: uri, kind: "editor", label: file.name },
      undefined,
      { replaceTabId: opts?.replaceUri },
    )
  }

  popPanelBuffer(tree: JetPanelTree, panelId: PanelId, uri: string): void {
    this.closeTabInPanel(tree, panelId, uri)
  }

  openUntitledInPanel(
    tree: JetPanelTree,
    panelId: PanelId,
    opts?: { label?: string; languageId?: string },
  ): string {
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
    this.openTabInPanel(tree, panelId, { id: uri, kind: "editor", label })
    return uri
  }

  promoteUntitled(oldUri: string, fileUri: string, path: string): void {
    const file = this.files.get(oldUri)
    if (!file) return
    this.files.delete(oldUri)
    const promoted = this.createWorkspaceFile(fileUri, path)
    const idx = this.openBuffers.indexOf(oldUri)
    if (idx >= 0) this.openBuffers[idx] = fileUri
    else this.touchBuffer(fileUri)
    this.tabRegistry.dispose(oldUri)
    this.tabRegistry.register({ id: fileUri, kind: "editor", label: promoted.name })
    this.onDidChangeBuffers.fire()
  }

  showPanelView(tree: JetPanelTree, panelId: PanelId, view: PanelView): void {
    tree.setView(panelId, view)
  }

  explorerTab(): TabDescriptor {
    return { id: EXPLORER_TAB_ID, kind: "explorer", label: "Explorer" }
  }

  outputTab(): TabDescriptor {
    return { id: OUTPUT_TAB_ID, kind: "output", label: "Output" }
  }

  ensureProblemsList(): ListDocument {
    const id = PROBLEMS_TAB_ID
    const existing = this.listStore.get(id)
    if (existing) return existing
    const doc: ListDocument = {
      id,
      title: "Problems",
      feed: "problems",
      items: [],
    }
    this.listStore.create(doc)
    this.tabRegistry.register({ id, kind: "problems", label: "Problems" })
    return doc
  }

  createSearchList(): ListDocument {
    const id = allocListId()
    const doc: ListDocument = {
      id,
      title: "Search",
      feed: "search",
      items: [],
      searchQuery: "",
      searchCaseSensitive: false,
      searchRegex: false,
      searchFuzzy: false,
      searchLoading: false,
      searchError: null,
    }
    this.listStore.create(doc)
    this.tabRegistry.register({ id, kind: "search", label: "Search" })
    return doc
  }

  createReferencesList(title: string, items: ListDocument["items"]): ListDocument {
    const id = allocListId()
    const doc: ListDocument = { id, title, feed: "references", items }
    this.listStore.create(doc)
    this.tabRegistry.register({ id, kind: "references", label: title })
    return doc
  }

  createTaskErrorsList(
    title: string,
    items: ListDocument["items"],
    taskLabel: string,
    taskStatus: ListDocument["taskStatus"],
  ): ListDocument {
    const id = allocListId()
    const doc: ListDocument = {
      id,
      title,
      feed: "task-errors",
      items,
      taskLabel,
      taskStatus,
    }
    this.listStore.create(doc)
    this.tabRegistry.register({ id, kind: "task-errors", label: title })
    return doc
  }

  panelHasExplorerTab(tree: JetPanelTree, panel: PanelId): boolean {
    return panelHasTab(tree.getView(panel), EXPLORER_TAB_ID)
  }

  mountExplorerTab(tree: JetPanelTree, panelId: PanelId): void {
    this.openTabInPanel(tree, panelId, this.explorerTab())
  }
}

export { EXPLORER_TAB_ID, OUTPUT_TAB_ID, PROBLEMS_TAB_ID }
export type { TabDescriptor, TabKind }
