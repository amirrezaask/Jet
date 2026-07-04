import { basename, Emitter, languageIdFromPath, pathToFileUri, makeUntitledUri } from "@jet/shared"
import type { PanelId, PanelView } from "@jet/shared"
import type { PanelTree } from "@jet/panels"
import type { WorkspaceFile, WorkspaceRoot } from "./types.js"
import type { FileSystemProvider } from "./types.js"
import { JumpStack } from "./jump-stack.js"
import { LocationListState } from "./location-list.js"
import { TaskRunner } from "./task-runner.js"
import { popPanelBufferView, pushPanelBufferView } from "./panel-buffers.js"

export class WorkspaceService {
  root: WorkspaceRoot | null = null
  private files = new Map<string, WorkspaceFile>()
  private savedBaseline = new Map<string, string>()
  private recentWrites = new Map<string, number>()
  private untitledCounter = 1
  /** Open buffer URIs in MRU order */
  openBuffers: string[] = []

  readonly jumpStack = new JumpStack()
  readonly locationList = new LocationListState()
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

  assignEditorPanel(
    tree: PanelTree,
    panelId: PanelId,
    uri: string,
    path: string,
    opts?: { replaceUri?: string },
  ): void {
    let file = this.files.get(uri)
    if (!file) file = this.createWorkspaceFile(uri, path)
    const current = tree.getView(panelId)
    tree.setView(panelId, pushPanelBufferView(current, uri, opts?.replaceUri))
    this.touchBuffer(uri)
    this.onDidOpenFile.fire(file)
  }

  popPanelBuffer(tree: PanelTree, panelId: PanelId, uri: string): void {
    const view = tree.getView(panelId)
    if (!view || view.kind !== "editor") return
    tree.setView(panelId, popPanelBufferView(view, uri))
  }

  openUntitledInPanel(
    tree: PanelTree,
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
    tree.setView(panelId, pushPanelBufferView(tree.getView(panelId), uri))
    this.touchBuffer(uri)
    this.onDidOpenFile.fire(file)
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
    this.onDidChangeBuffers.fire()
    void promoted
  }

  showPanelView(tree: PanelTree, panelId: PanelId, view: PanelView): void {
    tree.setView(panelId, view)
  }

  ensurePanelView(
    tree: PanelTree,
    panelId: PanelId,
    viewKind: Exclude<PanelView["kind"], "editor" | "empty">,
  ): PanelId {
    const existing = tree.findPanelWithView(v => v.kind === viewKind)
    if (existing) {
      tree.setView(existing, { kind: viewKind })
      return existing
    }

    const sidebarPanel = tree.findPanelWithView(v => isSidebarView(v))
    if (sidebarPanel) {
      tree.setView(sidebarPanel, { kind: viewKind })
      return sidebarPanel
    }

    const fallbackView = tree.getView(panelId)
    if (fallbackView?.kind === "editor" || fallbackView?.kind === "empty") {
      const newSidebar = tree.attachAtViewportEdge("left")
      tree.setView(newSidebar, { kind: viewKind })
      return newSidebar
    }

    tree.setView(panelId, { kind: viewKind })
    return panelId
  }
}

const SIDEBAR_VIEW_KINDS = new Set<PanelView["kind"]>(["explorer", "locationlist", "output"])

function isSidebarView(view: PanelView): boolean {
  return SIDEBAR_VIEW_KINDS.has(view.kind)
}
