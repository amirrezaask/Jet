import type * as monaco from "monaco-editor/esm/vs/editor/editor.api.js"
import {
  canonicalizeFileUri,
  Emitter,
  fileUriToPath,
  isUntitledUri,
} from "@yaade/shared"
import type { WorkspaceService } from "@yaade/workspace"
import { isLargeFile, monacoModels } from "@yaade/monaco"
import { EditorBufferVersionToken } from "./editor-buffer-version.js"

export type EditorBufferSnapshot = {
  uri: string
  languageId: string
  dirty: boolean
  open: boolean
  largeFile: boolean
  lspEnabled: boolean
  alternativeVersionId: number
  savedAlternativeVersionId: number
}

export type EditorBufferOpenOptions = {
  uri: string
  languageId: string
  /** Avoids disk I/O for untitled buffers and recovery restores. */
  initialContent?: string
  /** Recovered and dropped content starts dirty even though its model is new. */
  initialDirty?: boolean
}

export type EditorBufferLspHooks = {
  open(uri: string): void | Promise<void>
  close(uri: string): void | Promise<void>
}

export type EditorBufferServiceDependencies = {
  readFile(uri: string): Promise<string>
}

type BufferEntry = {
  uri: string
  languageId: string
  model: monaco.editor.ITextModel
  versionToken: EditorBufferVersionToken
  dirty: boolean
  open: boolean
  largeFile: boolean
  lspEnabled: boolean
  lspOpened: boolean
  lspGeneration: number
  changeSubscription: monaco.IDisposable
}

function canonicalUri(uri: string): string {
  return uri.startsWith("file://") ? canonicalizeFileUri(uri) : uri
}

function bufferOwner(uri: string): string {
  return `buffer:${uri}`
}

/**
 * Owns editor models independently from mounted React/Monaco views.
 *
 * The service is loaded only with the lazy editor chunk. WorkspaceService owns
 * user-facing open/dirty metadata; document content remains in Monaco.
 */
export class EditorBufferService {
  private readonly entries = new Map<string, BufferEntry>()
  private readonly pending = new Map<
    string,
    {
      promise: Promise<monaco.editor.ITextModel>
      initialDirty: boolean
    }
  >()
  private readonly closeAfterOpen = new Set<string>()
  private readonly onDidChangeEmitter = new Emitter<EditorBufferSnapshot>()
  private lspHooks: EditorBufferLspHooks | null = null

  readonly onDidChange = this.onDidChangeEmitter.event

  constructor(
    private readonly workspace: WorkspaceService,
    private readonly dependencies: EditorBufferServiceDependencies,
  ) {}

  setLspHooks(hooks: EditorBufferLspHooks | null): void {
    if (this.lspHooks === hooks) return
    const previous = this.lspHooks
    if (previous) {
      for (const entry of this.entries.values()) {
        if (!entry.lspOpened) continue
        entry.lspOpened = false
        entry.lspGeneration++
        void Promise.resolve(previous.close(entry.uri)).catch(() => {})
      }
    }
    this.lspHooks = hooks
    if (!hooks) return
    for (const entry of this.entries.values()) this.openLspIfEligible(entry)
  }

  async open(options: EditorBufferOpenOptions): Promise<monaco.editor.ITextModel> {
    const uri = canonicalUri(options.uri)
    this.closeAfterOpen.delete(uri)
    const existing = this.entries.get(uri)
    if (existing) {
      existing.open = true
      existing.languageId = options.languageId
      monacoModels.setLanguage(uri, options.languageId)
      monacoModels.retain(uri, bufferOwner(uri))
      monacoModels.setPinned(uri, { open: true, dirty: existing.dirty })
      this.ensureWorkspaceFile(existing)
      this.workspace.touchBuffer(uri)
      this.emit(existing)
      this.openLspIfEligible(existing)
      return existing.model
    }

    const inFlight = this.pending.get(uri)
    if (inFlight) return inFlight.promise

    const opening = this.openNew({ ...options, uri })
    this.pending.set(uri, {
      promise: opening,
      initialDirty: options.initialDirty === true,
    })
    try {
      const model = await opening
      if (this.closeAfterOpen.delete(uri)) this.close(uri)
      return model
    } finally {
      this.pending.delete(uri)
    }
  }

  private async openNew(options: EditorBufferOpenOptions): Promise<monaco.editor.ITextModel> {
    const content =
      options.initialContent ??
      (isUntitledUri(options.uri) ? "" : await this.dependencies.readFile(options.uri))
    const model = monacoModels.getOrCreate(options.uri, content, options.languageId)
    monacoModels.retain(options.uri, bufferOwner(options.uri))

    const initialAlternativeVersion = model.getAlternativeVersionId()
    const dirty = options.initialDirty === true
    const entry = {} as BufferEntry
    const changeSubscription = model.onDidChangeContent(() => {
      const live = this.entries.get(options.uri)
      if (!live) return
      const nextDirty = live.versionToken.isDirty(
        live.model.getAlternativeVersionId(),
      )
      if (live.dirty === nextDirty) return
      live.dirty = nextDirty
      this.workspace.markDirty(live.uri, nextDirty)
      monacoModels.setPinned(live.uri, { open: live.open, dirty: nextDirty })
      this.emit(live)
    })
    Object.assign(entry, {
      uri: options.uri,
      languageId: options.languageId,
      model,
      versionToken: new EditorBufferVersionToken(
        dirty ? 0 : initialAlternativeVersion,
      ),
      dirty,
      open: true,
      largeFile: isLargeFile(content),
      lspEnabled: false,
      lspOpened: false,
      lspGeneration: 0,
      changeSubscription,
    } satisfies BufferEntry)
    this.entries.set(options.uri, entry)

    this.ensureWorkspaceFile(entry)
    this.workspace.touchBuffer(options.uri)
    this.workspace.markDirty(options.uri, dirty)
    monacoModels.setPinned(options.uri, { open: true, dirty })
    this.emit(entry)
    this.openLspIfEligible(entry)
    return model
  }

  get(uri: string): monaco.editor.ITextModel | undefined {
    return this.entries.get(canonicalUri(uri))?.model
  }

  snapshot(uri: string): EditorBufferSnapshot | null {
    const entry = this.entries.get(canonicalUri(uri))
    return entry ? this.toSnapshot(entry) : null
  }

  snapshots(): EditorBufferSnapshot[] {
    return [...this.entries.values()]
      .map(entry => this.toSnapshot(entry))
      .sort((a, b) => a.uri.localeCompare(b.uri))
  }

  isDirty(uri: string): boolean {
    return this.entries.get(canonicalUri(uri))?.dirty ?? false
  }

  /** Marks the current Monaco undo point as the durable disk version. */
  markSaved(uri: string): void {
    const entry = this.entries.get(canonicalUri(uri))
    if (!entry) return
    entry.versionToken.markSaved(entry.model.getAlternativeVersionId())
    entry.dirty = false
    this.workspace.markDirty(entry.uri, false)
    monacoModels.setPinned(entry.uri, { open: entry.open, dirty: false })
    this.emit(entry)
  }

  /** Large files attach to LSP only after an explicit user command. */
  enableLsp(uri: string): boolean {
    const entry = this.entries.get(canonicalUri(uri))
    if (!entry) return false
    entry.lspEnabled = true
    this.emit(entry)
    this.openLspIfEligible(entry)
    return true
  }

  /**
   * Releases tab ownership. Dirty buffers remain pinned until an explicit
   * discard/save path resolves them.
   */
  close(uri: string, options?: { discard?: boolean }): boolean {
    const key = canonicalUri(uri)
    const entry = this.entries.get(key)
    if (!entry) {
      const opening = this.pending.get(key)
      if (!opening) return true
      if (opening.initialDirty) return false
      this.closeAfterOpen.add(key)
      return true
    }
    if (entry.dirty && options?.discard !== true) return false
    if (options?.discard) {
      entry.dirty = false
      this.workspace.markDirty(key, false)
    }
    entry.open = false
    monacoModels.release(key, bufferOwner(key))
    monacoModels.setPinned(key, { open: false, dirty: entry.dirty })
    this.closeLsp(entry)
    this.workspace.closeBuffer(key)
    this.emit(entry)
    monacoModels.evictClosedClean()
    return true
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      entry.changeSubscription.dispose()
      monacoModels.release(entry.uri, bufferOwner(entry.uri))
      monacoModels.setPinned(entry.uri, { open: false, dirty: entry.dirty })
      this.closeLsp(entry)
    }
    this.entries.clear()
    this.pending.clear()
    this.closeAfterOpen.clear()
    monacoModels.evictClosedClean()
  }

  private openLspIfEligible(entry: BufferEntry): void {
    if (
      !entry.open ||
      entry.lspOpened ||
      isUntitledUri(entry.uri) ||
      (entry.largeFile && !entry.lspEnabled) ||
      !this.lspHooks
    ) {
      return
    }
    const hooks = this.lspHooks
    const generation = ++entry.lspGeneration
    entry.lspOpened = true
    void Promise.resolve(hooks.open(entry.uri)).then(
      () => {
        if (
          generation === entry.lspGeneration &&
          entry.open &&
          entry.lspOpened
        ) {
          return
        }
        void Promise.resolve(hooks.close(entry.uri)).catch(() => {})
      },
      () => {
        if (generation === entry.lspGeneration) entry.lspOpened = false
      },
    )
  }

  private closeLsp(entry: BufferEntry): void {
    if (!entry.lspOpened) return
    const hooks = this.lspHooks
    entry.lspOpened = false
    entry.lspGeneration++
    void Promise.resolve(hooks?.close(entry.uri)).catch(() => {})
  }

  private emit(entry: BufferEntry): void {
    this.onDidChangeEmitter.fire(this.toSnapshot(entry))
  }

  private toSnapshot(entry: BufferEntry): EditorBufferSnapshot {
    return {
      uri: entry.uri,
      languageId: entry.languageId,
      dirty: entry.dirty,
      open: entry.open,
      largeFile: entry.largeFile,
      lspEnabled: entry.lspEnabled,
      alternativeVersionId: entry.model.getAlternativeVersionId(),
      savedAlternativeVersionId: entry.versionToken.savedVersion(),
    }
  }

  private ensureWorkspaceFile(entry: BufferEntry): void {
    let file = this.workspace.fileForUri(entry.uri)
    if (!file && isUntitledUri(entry.uri)) {
      file = {
        uri: entry.uri,
        path: "",
        name: entry.uri.replace(/^untitled:/, "") || "Untitled",
        languageId: entry.languageId,
        isDirty: entry.dirty,
      }
      this.workspace.registerFile(file)
    }
    file ??= this.workspace.createWorkspaceFile(
      entry.uri,
      fileUriToPath(entry.uri),
    )
    file.languageId = entry.languageId
  }
}

const services = new WeakMap<WorkspaceService, EditorBufferService>()

/** Session-scoped lazy service. Monaco enters the graph only when this module loads. */
export function editorBufferServiceFor(workspace: WorkspaceService): EditorBufferService {
  const existing = services.get(workspace)
  if (existing) return existing
  const service = new EditorBufferService(workspace, {
    readFile: uri => workspace.readFile(uri),
  })
  services.set(workspace, service)
  return service
}

export function disposeEditorBufferService(workspace: WorkspaceService): void {
  const service = services.get(workspace)
  if (!service) return
  service.dispose()
  services.delete(workspace)
}
