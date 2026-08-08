import type * as monaco from "monaco-editor/esm/vs/editor/editor.api.js"
import {
  canonicalizeFileUri,
  Emitter,
  fileUriToPath,
  isUntitledUri,
} from "@yaade/shared"
import type { WorkspaceService } from "@yaade/workspace"
import {
  ensureLanguageContribution,
  isLargeFile,
  monacoModels,
} from "@yaade/monaco"
import { EditorBufferVersionToken } from "./editor-buffer-version.js"
import { EditorRecoveryQueue } from "./editor-recovery-queue.js"

export type EditorBufferSnapshot = {
  uri: string
  languageId: string
  dirty: boolean
  open: boolean
  largeFile: boolean
  lspEnabled: boolean
  externalConflict: boolean
  ownerCount: number
  owners: string[]
  diskVersion: string | null
  diskSize: number
  alternativeVersionId: number
  savedAlternativeVersionId: number
}

export type EditorBufferOpenOptions = {
  uri: string
  languageId: string
  /** Stable tab/group identity; duplicate views of one URI retain independently. */
  ownerId?: string
  /** Avoids disk I/O for untitled buffers and recovery restores. */
  initialContent?: string
  /** Recovered and dropped content starts dirty even though its model is new. */
  initialDirty?: boolean
  /** Opaque version of the disk text that recovery was based on. */
  baseDiskVersion?: string | null
  initialDiskSize?: number
}

export type EditorBufferLspHooks = {
  open(uri: string): void | Promise<void>
  close(uri: string): void | Promise<void>
  save?(
    uri: string,
    persist: (content: string) => Promise<void>,
    reason?: Parameters<
      import("@yaade/lsp").LspClientHandle["saveDocument"]
    >[2],
  ): void | Promise<void>
}

export type EditorBufferServiceDependencies = {
  readTextFile(
    uri: string,
  ): Promise<{ content: string; version: string; size: number }>
  writeTextFile(
    uri: string,
    content: string,
    options: { expectedVersion: string } | { create: true },
  ): Promise<{ version: string; size: number }>
  onFileChanged?(callback: (uri: string) => void): () => void
  getRecovery?(
    sessionId: string,
    uri: string,
  ): Promise<{
    content: string
    baseVersion: string | null
    languageId: string
    contentBytes: number
  } | null>
  upsertRecovery?(input: {
    sessionId: string
    uri: string
    content: string
    baseVersion: string | null
    languageId: string
  }): Promise<unknown>
  deleteRecovery?(sessionId: string, uri: string): Promise<unknown>
}

export class SaveAsRequiredError extends Error {
  readonly code = "SAVE_AS_REQUIRED"

  constructor(readonly uri: string) {
    super(`Save As is required for ${uri}`)
  }
}

export class ExternalFileConflictError extends Error {
  readonly code = "FILE_CHANGED"

  constructor(readonly uri: string) {
    super(`Resolve the disk conflict before saving ${uri}`)
  }
}

export type EditorBufferComparison = {
  uri: string
  languageId: string
  diskContent: string
  bufferContent: string
  diskVersion: string
}

function isFileChangedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  return (
    ("code" in error && error.code === "FILE_CHANGED") ||
    ("status" in error && error.status === 409)
  )
}

type BufferEntry = {
  uri: string
  languageId: string
  model: monaco.editor.ITextModel
  versionToken: EditorBufferVersionToken
  dirty: boolean
  open: boolean
  ownerIds: Set<string>
  diskVersion: string | null
  diskSize: number
  largeFile: boolean
  lspEnabled: boolean
  lspOpened: boolean
  lspGeneration: number
  externalConflict: boolean
  writeInFlight: number
  externalEventDuringWrite: boolean
  changeSubscription: monaco.IDisposable
  recoveryTimer: ReturnType<typeof setTimeout> | null
}

function canonicalUri(uri: string): string {
  return uri.startsWith("file://") ? canonicalizeFileUri(uri) : uri
}

function bufferOwner(uri: string, ownerId: string): string {
  return `buffer:${ownerId}:${uri}`
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
      owners: Set<string>
    }
  >()
  private readonly onDidChangeEmitter = new Emitter<EditorBufferSnapshot>()
  private readonly recoveryQueue = new EditorRecoveryQueue()
  private lspHooks: EditorBufferLspHooks | null = null
  private readonly disposeFileWatch: (() => void) | null
  private sessionId: string | null
  private readonly onPageHide = () => {
    void this.flushRecovery()
  }

  readonly onDidChange = this.onDidChangeEmitter.event

  constructor(
    private readonly workspace: WorkspaceService,
    private readonly dependencies: EditorBufferServiceDependencies,
    sessionId?: string,
  ) {
    this.sessionId = sessionId ?? null
    this.disposeFileWatch =
      dependencies.onFileChanged?.(uri => {
        void this.handleExternalFileChange(uri)
      }) ?? null
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", this.onPageHide)
    }
  }

  setSessionId(sessionId: string): void {
    if (
      this.sessionId &&
      this.sessionId !== sessionId &&
      this.entries.size > 0
    ) {
      throw new Error("EditorBufferService cannot move between live sessions")
    }
    this.sessionId = sessionId
  }

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

  async open(
    options: EditorBufferOpenOptions,
  ): Promise<monaco.editor.ITextModel> {
    const uri = canonicalUri(options.uri)
    const ownerId = options.ownerId ?? "default"
    const existing = this.entries.get(uri)
    if (existing) {
      existing.ownerIds.add(ownerId)
      existing.open = true
      existing.languageId = options.languageId
      monacoModels.setLanguage(uri, options.languageId)
      monacoModels.retain(uri, bufferOwner(uri, ownerId))
      monacoModels.setPinned(uri, { open: true, dirty: existing.dirty })
      this.ensureWorkspaceFile(existing)
      this.workspace.touchBuffer(uri)
      this.emit(existing)
      this.openLspIfEligible(existing)
      return existing.model
    }

    const inFlight = this.pending.get(uri)
    if (inFlight) {
      inFlight.owners.add(ownerId)
      return inFlight.promise
    }

    const pending: {
      promise: Promise<monaco.editor.ITextModel>
      initialDirty: boolean
      owners: Set<string>
    } = {
      promise: Promise.resolve(null as unknown as monaco.editor.ITextModel),
      initialDirty: options.initialDirty === true,
      owners: new Set([ownerId]),
    }
    this.pending.set(uri, pending)
    const opening = this.openNew({ ...options, uri, ownerId })
    pending.promise = opening
    try {
      return await opening
    } finally {
      this.pending.delete(uri)
    }
  }

  private async openNew(
    options: EditorBufferOpenOptions,
  ): Promise<monaco.editor.ITextModel> {
    const recovery =
      options.initialContent == null &&
      this.sessionId &&
      this.dependencies.getRecovery
        ? await this.dependencies.getRecovery(this.sessionId, options.uri)
        : null
    let restoredDirty = false
    let restoredConflict = false
    let loaded: { content: string; version: string | null; size: number }
    if (options.initialContent != null) {
      loaded = {
        content: options.initialContent,
        version: options.baseDiskVersion ?? null,
        size:
          options.initialDiskSize ??
          new TextEncoder().encode(options.initialContent).byteLength,
      }
    } else if (recovery && isUntitledUri(options.uri)) {
      loaded = {
        content: recovery.content,
        version: null,
        size: recovery.contentBytes,
      }
      restoredDirty = true
    } else if (recovery) {
      try {
        const disk = await this.dependencies.readTextFile(options.uri)
        if (disk.content === recovery.content) {
          loaded = disk
          if (this.sessionId) {
            void this.deleteRecovery(options.uri)
          }
        } else {
          loaded = {
            content: recovery.content,
            version: disk.version,
            size: recovery.contentBytes,
          }
          restoredDirty = true
          restoredConflict = recovery.baseVersion !== disk.version
        }
      } catch {
        loaded = {
          content: recovery.content,
          version: null,
          size: recovery.contentBytes,
        }
        restoredDirty = true
        restoredConflict = true
      }
    } else {
      loaded = isUntitledUri(options.uri)
        ? { content: "", version: null, size: 0 }
        : await this.dependencies.readTextFile(options.uri)
    }
    const content = loaded.content
    await ensureLanguageContribution(options.languageId)
    const model = monacoModels.getOrCreate(
      options.uri,
      content,
      options.languageId,
    )
    const cachedState = monacoModels.pinState(options.uri)
    if (
      monacoModels.ownerCount(options.uri) === 0 &&
      cachedState?.open !== true &&
      cachedState?.dirty !== true &&
      model.getValue() !== content
    ) {
      model.setValue(content)
    }
    const ownerIds = new Set(
      this.pending.get(options.uri)?.owners ?? [options.ownerId ?? "default"],
    )
    for (const ownerId of ownerIds) {
      monacoModels.retain(options.uri, bufferOwner(options.uri, ownerId))
    }

    const initialAlternativeVersion = model.getAlternativeVersionId()
    const dirty = options.initialDirty === true || restoredDirty
    const entry = {} as BufferEntry
    const changeSubscription = model.onDidChangeContent(() => {
      const live = this.entries.get(options.uri)
      if (!live) return
      const nextDirty = live.versionToken.isDirty(
        live.model.getAlternativeVersionId(),
      )
      if (live.dirty !== nextDirty) {
        live.dirty = nextDirty
        this.workspace.markDirty(live.uri, nextDirty)
        monacoModels.setPinned(live.uri, { open: live.open, dirty: nextDirty })
        this.emit(live)
      }
      // Recovery is idle-based, so every dirty change must restart the timer.
      // Only reacting to the clean -> dirty transition would persist an early
      // edit while silently dropping later keystrokes.
      if (nextDirty) this.scheduleRecovery(live)
      else this.clearRecovery(live)
    })
    Object.assign(entry, {
      uri: options.uri,
      languageId: options.languageId,
      model,
      versionToken: new EditorBufferVersionToken(
        dirty ? 0 : initialAlternativeVersion,
      ),
      dirty,
      open: ownerIds.size > 0,
      ownerIds,
      diskVersion: loaded.version,
      diskSize: loaded.size,
      largeFile: isLargeFile(content),
      lspEnabled: false,
      lspOpened: false,
      lspGeneration: 0,
      externalConflict: restoredConflict,
      writeInFlight: 0,
      externalEventDuringWrite: false,
      changeSubscription,
      recoveryTimer: null,
    } satisfies BufferEntry)
    this.entries.set(options.uri, entry)

    if (entry.open) {
      this.ensureWorkspaceFile(entry)
      this.workspace.touchBuffer(options.uri)
      this.workspace.markDirty(options.uri, dirty)
    }
    monacoModels.setPinned(options.uri, { open: entry.open, dirty })
    this.emit(entry)
    this.openLspIfEligible(entry)
    if (dirty) this.scheduleRecovery(entry)
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

  /** Explicit save is the only normal typing path that serializes the model. */
  async save(uri: string): Promise<void> {
    const key = canonicalUri(uri)
    const entry = this.entries.get(key)
    if (!entry) throw new Error(`Editor buffer is not open: ${key}`)
    if (isUntitledUri(key)) throw new SaveAsRequiredError(key)
    if (entry.externalConflict) throw new ExternalFileConflictError(key)
    if (entry.diskVersion == null) {
      throw new Error(`Cannot overwrite ${key} without a disk version`)
    }
    const persist = async (content: string) => {
      const persistedAlternativeVersion = entry.model.getAlternativeVersionId()
      entry.writeInFlight++
      try {
        const result = await this.dependencies.writeTextFile(key, content, {
          expectedVersion: entry.diskVersion!,
        })
        entry.diskVersion = result.version
        entry.diskSize = result.size
        entry.externalConflict = false
        await this.markPersistedVersion(entry, persistedAlternativeVersion)
      } catch (error) {
        if (isFileChangedError(error)) {
          entry.externalConflict = true
          this.emit(entry)
        }
        throw error
      } finally {
        entry.writeInFlight--
        if (entry.writeInFlight === 0 && entry.externalEventDuringWrite) {
          entry.externalEventDuringWrite = false
          queueMicrotask(() => void this.handleExternalFileChange(key))
        }
      }
    }
    if (entry.lspOpened && this.lspHooks?.save) {
      await this.lspHooks.save(key, persist, 1)
    } else {
      await persist(entry.model.getValue())
    }
  }

  /**
   * Atomically creates a new file and moves every open view owner to it.
   * The caller remaps panel tab ids after this succeeds; the untitled/source
   * model remains untouched when the create fails.
   */
  async saveAs(uri: string, targetUri: string): Promise<string> {
    const sourceKey = canonicalUri(uri)
    const targetKey = canonicalUri(targetUri)
    if (sourceKey === targetKey) {
      await this.save(sourceKey)
      return targetKey
    }
    if (!targetKey.startsWith("file://")) {
      throw new Error("Save As requires a file URI")
    }
    if (this.entries.has(targetKey)) {
      throw new Error(`The target file is already open: ${targetKey}`)
    }
    const source = this.entries.get(sourceKey)
    if (!source) throw new Error(`Editor buffer is not open: ${sourceKey}`)

    const content = source.model.getValue()
    const persistedAlternativeVersion = source.model.getAlternativeVersionId()
    const created = await this.dependencies.writeTextFile(targetKey, content, {
      create: true,
    })
    const currentContent = source.model.getValue()
    const initiallyChangedDuringSave =
      source.model.getAlternativeVersionId() !== persistedAlternativeVersion
    const owners = [...source.ownerIds]
    const firstOwner = owners[0] ?? "default"
    await this.open({
      uri: targetKey,
      languageId: source.languageId,
      ownerId: firstOwner,
      initialContent: currentContent,
      initialDirty: initiallyChangedDuringSave,
      baseDiskVersion: created.version,
      initialDiskSize: created.size,
    })
    for (const ownerId of owners.slice(1)) {
      await this.open({
        uri: targetKey,
        languageId: source.languageId,
        ownerId,
      })
    }
    const target = this.entries.get(targetKey)
    if (!target) throw new Error(`Could not open saved file: ${targetKey}`)
    // Opening every retained owner may load a lazy contribution. Reconcile one
    // final snapshot before synchronously releasing the source so edits made
    // during that work are promoted instead of discarded.
    const finalContent = source.model.getValue()
    const changedDuringSave = finalContent !== content
    if (target.model.getValue() !== finalContent) {
      target.model.setValue(finalContent)
    }
    if (!changedDuringSave) {
      target.versionToken.markSaved(target.model.getAlternativeVersionId())
    }
    target.dirty = changedDuringSave
    target.diskVersion = created.version
    target.diskSize = created.size
    target.externalConflict = false
    this.workspace.markDirty(targetKey, changedDuringSave)
    monacoModels.setPinned(targetKey, {
      open: target.open,
      dirty: changedDuringSave,
    })
    this.emit(target)

    if (isUntitledUri(sourceKey)) {
      this.workspace.promoteUntitled(
        sourceKey,
        targetKey,
        fileUriToPath(targetKey),
      )
    } else {
      this.workspace.closeBuffer(sourceKey)
      this.ensureWorkspaceFile(target)
      this.workspace.touchBuffer(targetKey)
    }
    source.dirty = false
    this.workspace.markDirty(sourceKey, false)
    this.close(sourceKey, { discard: true })
    await this.deleteRecovery(sourceKey)
    if (changedDuringSave) this.scheduleRecovery(target)
    else await this.deleteRecovery(targetKey)
    return targetKey
  }

  async saveAll(uris?: readonly string[]): Promise<void> {
    const targets = uris
      ? [...new Set(uris.map(canonicalUri))]
      : [...this.entries.values()]
          .filter(entry => entry.dirty)
          .map(entry => entry.uri)
    for (const uri of targets) {
      if (this.isDirty(uri)) await this.save(uri)
    }
  }

  /** Restore the durable disk content before a destructive close. */
  async discard(uri: string): Promise<void> {
    const key = canonicalUri(uri)
    const entry = this.entries.get(key)
    if (!entry) return
    const content = isUntitledUri(key)
      ? { content: "", version: null, size: 0 }
      : await this.dependencies.readTextFile(key)
    entry.model.setValue(content.content)
    entry.diskVersion = content.version
    entry.diskSize = content.size
    entry.versionToken.markSaved(entry.model.getAlternativeVersionId())
    entry.dirty = false
    entry.externalConflict = false
    this.workspace.markDirty(key, false)
    monacoModels.setPinned(key, { open: entry.open, dirty: false })
    this.emit(entry)
    await this.deleteRecovery(key)
  }

  /** Reload the current disk version, discarding the recovered/local text. */
  async reloadFromDisk(uri: string): Promise<void> {
    await this.discard(uri)
  }

  /** Read-only inputs for a diff view. No model or disk state is mutated. */
  async compareWithDisk(uri: string): Promise<EditorBufferComparison> {
    const key = canonicalUri(uri)
    const entry = this.entries.get(key)
    if (!entry) throw new Error(`Editor buffer is not open: ${key}`)
    if (isUntitledUri(key)) {
      throw new Error("Untitled buffers do not have a disk version to compare")
    }
    const disk = await this.dependencies.readTextFile(key)
    return {
      uri: key,
      languageId: entry.languageId,
      diskContent: disk.content,
      bufferContent: entry.model.getValue(),
      diskVersion: disk.version,
    }
  }

  /** Explicitly overwrite the latest disk version with the current buffer. */
  async keepMine(uri: string): Promise<void> {
    const key = canonicalUri(uri)
    const entry = this.entries.get(key)
    if (!entry) throw new Error(`Editor buffer is not open: ${key}`)
    if (isUntitledUri(key)) throw new SaveAsRequiredError(key)
    const disk = await this.dependencies.readTextFile(key)
    entry.diskVersion = disk.version
    const content = entry.model.getValue()
    const persistedAlternativeVersion = entry.model.getAlternativeVersionId()
    entry.writeInFlight++
    try {
      const result = await this.dependencies.writeTextFile(key, content, {
        expectedVersion: disk.version,
      })
      entry.diskVersion = result.version
      entry.diskSize = result.size
      entry.externalConflict = false
      await this.markPersistedVersion(entry, persistedAlternativeVersion)
    } finally {
      entry.writeInFlight--
      if (entry.writeInFlight === 0 && entry.externalEventDuringWrite) {
        entry.externalEventDuringWrite = false
        queueMicrotask(() => void this.handleExternalFileChange(key))
      }
    }
  }

  async handleExternalFileChange(uri: string): Promise<void> {
    const key = canonicalUri(uri)
    const entry = this.entries.get(key)
    if (!entry || isUntitledUri(key)) return
    if (entry.writeInFlight > 0) {
      entry.externalEventDuringWrite = true
      return
    }
    if (entry.dirty) {
      try {
        const loaded = await this.dependencies.readTextFile(key)
        // Watchers are debounced, so the create/open or our own completed save
        // event can arrive after the user has already typed. Only a new disk
        // version is a real dirty-buffer conflict.
        if (loaded.version === entry.diskVersion) return
      } catch {
        // Deletion/unreadable changes are conflicts for a dirty buffer.
      }
      entry.externalConflict = true
      this.emit(entry)
      return
    }
    try {
      const loaded = await this.dependencies.readTextFile(key)
      if (entry.model.getValue() !== loaded.content) {
        entry.model.setValue(loaded.content)
      }
      entry.diskVersion = loaded.version
      entry.diskSize = loaded.size
      entry.versionToken.markSaved(entry.model.getAlternativeVersionId())
      entry.dirty = false
      entry.externalConflict = false
      this.workspace.markDirty(key, false)
      monacoModels.setPinned(key, { open: entry.open, dirty: false })
      this.emit(entry)
    } catch {
      entry.externalConflict = true
      this.emit(entry)
    }
  }

  /** Marks the current Monaco undo point as the durable disk version. */
  markSaved(uri: string): void {
    const entry = this.entries.get(canonicalUri(uri))
    if (!entry) return
    entry.versionToken.markSaved(entry.model.getAlternativeVersionId())
    entry.dirty = false
    entry.externalConflict = false
    this.workspace.markDirty(entry.uri, false)
    monacoModels.setPinned(entry.uri, { open: entry.open, dirty: false })
    this.emit(entry)
    void this.deleteRecovery(entry.uri)
  }

  private async markPersistedVersion(
    entry: BufferEntry,
    persistedAlternativeVersion: number,
  ): Promise<void> {
    entry.versionToken.markSaved(persistedAlternativeVersion)
    entry.dirty = entry.versionToken.isDirty(
      entry.model.getAlternativeVersionId(),
    )
    this.workspace.markDirty(entry.uri, entry.dirty)
    monacoModels.setPinned(entry.uri, {
      open: entry.open,
      dirty: entry.dirty,
    })
    this.emit(entry)
    if (entry.dirty) {
      // Text typed after serialization belongs to the next save and must
      // remain recoverable even though this disk write succeeded.
      this.scheduleRecovery(entry)
      return
    }
    if (entry.recoveryTimer) {
      clearTimeout(entry.recoveryTimer)
      entry.recoveryTimer = null
    }
    await this.deleteRecovery(entry.uri)
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
  close(
    uri: string,
    options?: { discard?: boolean; ownerId?: string },
  ): boolean {
    const key = canonicalUri(uri)
    const entry = this.entries.get(key)
    if (!entry) {
      const opening = this.pending.get(key)
      if (!opening) return true
      if (opening.initialDirty) {
        if (!options?.ownerId || opening.owners.size <= 1) return false
      }
      if (options?.ownerId) {
        opening.owners.delete(options.ownerId)
      } else {
        opening.owners.clear()
      }
      return true
    }
    if (entry.dirty && options?.discard !== true) return false
    if (options?.discard) {
      entry.dirty = false
      this.workspace.markDirty(key, false)
    }
    const releasedOwners = options?.ownerId
      ? entry.ownerIds.has(options.ownerId)
        ? [options.ownerId]
        : []
      : [...entry.ownerIds]
    for (const ownerId of releasedOwners) {
      entry.ownerIds.delete(ownerId)
      monacoModels.release(key, bufferOwner(key, ownerId))
    }
    entry.open = entry.ownerIds.size > 0
    monacoModels.setPinned(key, { open: entry.open, dirty: entry.dirty })
    if (entry.open) {
      this.emit(entry)
      return true
    }
    this.closeLsp(entry)
    this.workspace.closeBuffer(key)
    this.emit(entry)
    monacoModels.evictClosedClean()
    return true
  }

  /** Atomically transfers one editor-group owner without closing dirty/LSP state. */
  moveOwner(uri: string, fromOwnerId: string, toOwnerId: string): boolean {
    const key = canonicalUri(uri)
    const entry = this.entries.get(key)
    if (!entry) {
      const opening = this.pending.get(key)
      if (!opening?.owners.has(fromOwnerId)) return false
      opening.owners.delete(fromOwnerId)
      opening.owners.add(toOwnerId)
      return true
    }
    if (!entry.ownerIds.has(fromOwnerId)) return false
    if (fromOwnerId === toOwnerId) return true
    if (!entry.ownerIds.has(toOwnerId)) {
      entry.ownerIds.add(toOwnerId)
      monacoModels.retain(key, bufferOwner(key, toOwnerId))
    }
    entry.ownerIds.delete(fromOwnerId)
    monacoModels.release(key, bufferOwner(key, fromOwnerId))
    entry.open = entry.ownerIds.size > 0
    monacoModels.setPinned(key, { open: entry.open, dirty: entry.dirty })
    this.emit(entry)
    return true
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      if (entry.recoveryTimer) clearTimeout(entry.recoveryTimer)
      if (entry.dirty) this.persistRecoveryBestEffort(entry)
      entry.changeSubscription.dispose()
      for (const ownerId of entry.ownerIds) {
        monacoModels.release(entry.uri, bufferOwner(entry.uri, ownerId))
      }
      entry.ownerIds.clear()
      monacoModels.setPinned(entry.uri, { open: false, dirty: false })
      this.closeLsp(entry)
      if (entry.dirty) {
        queueMicrotask(() => {
          if (monacoModels.ownerCount(entry.uri) === 0) {
            monacoModels.dispose(entry.uri)
          }
        })
      }
    }
    this.entries.clear()
    this.pending.clear()
    this.disposeFileWatch?.()
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.onPageHide)
    }
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

  async flushRecovery(): Promise<void> {
    await Promise.allSettled(
      [...this.entries.values()]
        .filter(entry => entry.dirty)
        .map(entry => this.persistRecovery(entry)),
    )
    await this.recoveryQueue.waitForIdle()
  }

  private scheduleRecovery(entry: BufferEntry): void {
    if (!this.sessionId || !this.dependencies.upsertRecovery) return
    if (entry.recoveryTimer) clearTimeout(entry.recoveryTimer)
    const delayMs = entry.model.getValueLength() > 1024 * 1024 ? 2_000 : 500
    entry.recoveryTimer = setTimeout(() => {
      entry.recoveryTimer = null
      this.persistRecoveryBestEffort(entry)
    }, delayMs)
  }

  private persistRecoveryBestEffort(entry: BufferEntry): void {
    void this.persistRecovery(entry).catch(error => {
      console.warn("Could not persist editor recovery buffer", error)
    })
  }

  private async persistRecovery(entry: BufferEntry): Promise<void> {
    const sessionId = this.sessionId
    if (!sessionId || !entry.dirty || !this.dependencies.upsertRecovery) return
    const input = {
      sessionId,
      uri: entry.uri,
      content: entry.model.getValue(),
      baseVersion: entry.diskVersion,
      languageId: entry.languageId,
    }
    await this.recoveryQueue.enqueue(entry.uri, () =>
      this.dependencies.upsertRecovery!(input),
    )
  }

  private clearRecovery(entry: BufferEntry): void {
    if (entry.recoveryTimer) {
      clearTimeout(entry.recoveryTimer)
      entry.recoveryTimer = null
    }
    void this.deleteRecovery(entry.uri).catch(error => {
      console.warn("Could not delete editor recovery buffer", error)
    })
  }

  private async deleteRecovery(uri: string): Promise<void> {
    if (!this.sessionId || !this.dependencies.deleteRecovery) return
    const sessionId = this.sessionId
    await this.recoveryQueue.enqueue(uri, () =>
      this.dependencies.deleteRecovery!(sessionId, uri),
    )
  }

  private toSnapshot(entry: BufferEntry): EditorBufferSnapshot {
    return {
      uri: entry.uri,
      languageId: entry.languageId,
      dirty: entry.dirty,
      open: entry.open,
      largeFile: entry.largeFile,
      lspEnabled: entry.lspEnabled,
      externalConflict: entry.externalConflict,
      ownerCount: entry.ownerIds.size,
      owners: [...entry.ownerIds].sort(),
      diskVersion: entry.diskVersion,
      diskSize: entry.diskSize,
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

type EditorBufferServiceRecord = {
  service: EditorBufferService
  retainCount: number
  disposeTimer: ReturnType<typeof setTimeout> | null
}

const services = new WeakMap<WorkspaceService, EditorBufferServiceRecord>()

/** Session-scoped lazy service. Monaco enters the graph only when this module loads. */
export function editorBufferServiceFor(
  workspace: WorkspaceService,
  sessionId?: string,
): EditorBufferService {
  const existing = services.get(workspace)?.service
  if (existing) {
    if (sessionId) existing.setSessionId(sessionId)
    return existing
  }
  const service = new EditorBufferService(
    workspace,
    {
      readTextFile: async uri => {
        const hostFs =
          typeof window !== "undefined" ? window.yaade?.fs : undefined
        if (hostFs?.readTextFile) return hostFs.readTextFile(uri)
        const content = await workspace.readFile(uri)
        return {
          content,
          version: `legacy:${new TextEncoder().encode(content).byteLength}`,
          size: new TextEncoder().encode(content).byteLength,
        }
      },
      writeTextFile: async (uri, content, options) => {
        const hostFs =
          typeof window !== "undefined" ? window.yaade?.fs : undefined
        if (hostFs?.writeTextFile) {
          return hostFs.writeTextFile(uri, content, options)
        }
        await workspace.writeFile(uri, content)
        return {
          version: `legacy:${new TextEncoder().encode(content).byteLength}`,
          size: new TextEncoder().encode(content).byteLength,
        }
      },
      onFileChanged: callback =>
        typeof window !== "undefined" && window.yaade?.fs.onFileChanged
          ? window.yaade.fs.onFileChanged(callback)
          : () => {},
      getRecovery: (recoverySessionId, uri) =>
        import("@yaade/host-client").then(({ getEditorRecoveryBuffer }) =>
          getEditorRecoveryBuffer(recoverySessionId, uri),
        ),
      upsertRecovery: input =>
        import("@yaade/host-client").then(({ upsertEditorRecoveryBuffer }) =>
          upsertEditorRecoveryBuffer(input),
        ),
      deleteRecovery: (recoverySessionId, uri) =>
        import("@yaade/host-client").then(({ deleteEditorRecoveryBuffer }) =>
          deleteEditorRecoveryBuffer(recoverySessionId, uri),
        ),
    },
    sessionId,
  )
  services.set(workspace, { service, retainCount: 0, disposeTimer: null })
  return service
}

/**
 * Retains the session-scoped service across React StrictMode's test unmount.
 * The final release disposes on the next task, giving an immediate remount a
 * chance to cancel teardown without leaking models after a real session exit.
 */
export function retainEditorBufferService(
  workspace: WorkspaceService,
  sessionId?: string,
): () => void {
  const service = editorBufferServiceFor(workspace, sessionId)
  const record = services.get(workspace)!
  if (record.disposeTimer) {
    clearTimeout(record.disposeTimer)
    record.disposeTimer = null
  }
  record.retainCount++
  let released = false
  return () => {
    if (released) return
    released = true
    const live = services.get(workspace)
    if (!live || live.service !== service) return
    live.retainCount = Math.max(0, live.retainCount - 1)
    if (live.retainCount > 0 || live.disposeTimer) return
    live.disposeTimer = setTimeout(() => {
      const current = services.get(workspace)
      if (!current || current !== live || current.retainCount > 0) return
      current.disposeTimer = null
      current.service.dispose()
      services.delete(workspace)
    }, 0)
  }
}

export function disposeEditorBufferService(workspace: WorkspaceService): void {
  const record = services.get(workspace)
  if (!record) return
  if (record.disposeTimer) clearTimeout(record.disposeTimer)
  record.service.dispose()
  services.delete(workspace)
}
