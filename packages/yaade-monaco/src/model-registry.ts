import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js"
import { canonicalizeFileUri } from "@yaade/shared"
import { monacoLanguageId } from "./language.js"
import { setModelLanguage } from "./model-language.js"

export const DIFF_ORIGINAL_SCHEME = "yaade-diff-original"
export const DIFF_MODIFIED_SCHEME = "yaade-diff-modified"
export const MAX_CLOSED_CLEAN_MODELS = 20
export const MAX_CLOSED_CLEAN_BYTES = 32 * 1024 * 1024

type ModelEntry = {
  model: monaco.editor.ITextModel
  owners: Set<string>
  open: boolean
  dirty: boolean
  lastUsed: number
}

export type MonacoModelPinState = {
  open: boolean
  dirty: boolean
}

export type MonacoModelDiagnostic = {
  uri: string
  /** Compatibility alias for ownerCount. */
  refCount: number
  ownerCount: number
  owners: string[]
  lspOwnerCount: number
  open: boolean
  dirty: boolean
  pinned: boolean
  lastUsed: number
  version: number
  bytes: number
  lines: number
  content: string
}

export type MonacoModelRegistryOptions = {
  maxClosedCleanModels?: number
  maxClosedCleanBytes?: number
}

type ViewStateKey = string

function viewStateKey(editorId: string, uri: string): ViewStateKey {
  return `${editorId}\0${uri}`
}

function utf8ByteLength(value: string): number {
  let bytes = 0
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x80) {
      bytes++
    } else if (code < 0x800) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        i++
      } else {
        bytes += 3
      }
    } else {
      bytes += 3
    }
  }
  return bytes
}

export class MonacoModelRegistry {
  private readonly models = new Map<string, ModelEntry>()
  private readonly viewStates = new Map<
    ViewStateKey,
    monaco.editor.ICodeEditorViewState | null
  >()
  private readonly maxClosedCleanModels: number
  private readonly maxClosedCleanBytes: number
  private accessClock = 0

  constructor(options: MonacoModelRegistryOptions = {}) {
    this.maxClosedCleanModels =
      options.maxClosedCleanModels ?? MAX_CLOSED_CLEAN_MODELS
    this.maxClosedCleanBytes =
      options.maxClosedCleanBytes ?? MAX_CLOSED_CLEAN_BYTES
  }

  canonicalKey(uri: string): string {
    if (uri.startsWith("file://")) return canonicalizeFileUri(uri)
    return uri
  }

  diffOriginalUri(baseUri: string): string {
    return `${DIFF_ORIGINAL_SCHEME}:${this.canonicalKey(baseUri)}`
  }

  diffModifiedUri(baseUri: string): string {
    return `${DIFF_MODIFIED_SCHEME}:${this.canonicalKey(baseUri)}`
  }

  has(uri: string): boolean {
    return this.models.has(this.canonicalKey(uri))
  }

  get(uri: string): monaco.editor.ITextModel | undefined {
    const entry = this.models.get(this.canonicalKey(uri))
    if (!entry) return undefined
    this.touch(entry)
    return entry.model
  }

  /** Create or reuse a model without assigning ownership. */
  getOrCreate(
    uri: string,
    content: string,
    languageId: string,
  ): monaco.editor.ITextModel {
    const key = this.canonicalKey(uri)
    const existing = this.models.get(key)
    if (existing) {
      this.touch(existing)
      return existing.model
    }

    const model = monaco.editor.createModel(
      content,
      monacoLanguageId(languageId),
      monaco.Uri.parse(key),
    )
    this.models.set(key, {
      model,
      owners: new Set(),
      open: false,
      dirty: false,
      lastUsed: this.nextAccess(),
    })
    return model
  }

  /** Idempotently retain a model for a stable named owner. */
  retain(
    uri: string,
    ownerId: string,
  ): monaco.editor.ITextModel | undefined {
    if (!ownerId) throw new Error("Monaco model owner id must not be empty")
    const entry = this.models.get(this.canonicalKey(uri))
    if (!entry) return undefined
    entry.owners.add(ownerId)
    this.touch(entry)
    return entry.model
  }

  /** Idempotently release a stable named owner. */
  release(uri: string, ownerId: string): void {
    if (!ownerId) throw new Error("Monaco model owner id must not be empty")
    const key = this.canonicalKey(uri)
    const entry = this.models.get(key)
    if (!entry) return
    const wasClosedClean = this.isClosedClean(entry)
    entry.owners.delete(ownerId)
    this.touch(entry)
    if (!wasClosedClean && this.isClosedClean(entry)) {
      this.evictClosedClean()
    }
  }

  /**
   * @deprecated Use retain(uri, ownerId). This compatibility path uses one
   * stable legacy owner rather than recreating anonymous reference counts.
   */
  acquire(
    uri: string,
    ownerId: string,
  ): monaco.editor.ITextModel | undefined {
    return this.retain(uri, ownerId)
  }

  setPinned(uri: string, state: Partial<MonacoModelPinState>): void {
    const entry = this.models.get(this.canonicalKey(uri))
    if (!entry) return
    const wasClosedClean = this.isClosedClean(entry)
    if (state.open != null) entry.open = state.open
    if (state.dirty != null) entry.dirty = state.dirty
    this.touch(entry)
    if (!wasClosedClean && this.isClosedClean(entry)) {
      this.evictClosedClean()
    }
  }

  ownerCount(uri: string): number {
    return this.models.get(this.canonicalKey(uri))?.owners.size ?? 0
  }

  owners(uri: string): string[] {
    return [
      ...(this.models.get(this.canonicalKey(uri))?.owners ?? []),
    ].sort()
  }

  pinState(uri: string): MonacoModelPinState | undefined {
    const entry = this.models.get(this.canonicalKey(uri))
    if (!entry) return undefined
    return { open: entry.open, dirty: entry.dirty }
  }

  setLanguage(uri: string, languageId: string): void {
    const model = this.get(uri)
    if (model) setModelLanguage(model, languageId)
  }

  getContent(uri: string): string | undefined {
    return this.get(uri)?.getValue()
  }

  updateContent(
    uri: string,
    content: string,
    options?: { preserveCursor?: boolean },
  ): boolean {
    const model = this.get(uri)
    if (!model) return false
    if (model.getValue() === content) return true

    if (options?.preserveCursor) {
      const fullRange = model.getFullModelRange()
      model.pushEditOperations(
        [],
        [{ range: fullRange, text: content }],
        () => null,
      )
    } else {
      model.setValue(content)
    }
    return true
  }

  /** Immediately dispose an unowned, unpinned model when a caller closes it. */
  disposeIfUnreferenced(
    uri: string,
    canDispose?: (uri: string) => boolean,
  ): boolean {
    const key = this.canonicalKey(uri)
    const entry = this.models.get(key)
    if (!entry || !this.isClosedClean(entry)) return false
    if (canDispose && !canDispose(key)) return false
    this.disposeEntry(key, entry)
    return true
  }

  /** Enforce the closed-clean cache limits, evicting least-recently-used first. */
  evictClosedClean(): string[] {
    const candidates = [...this.models.entries()]
      .filter(([, entry]) => this.isClosedClean(entry))
      .map(([uri, entry]) => ({
        uri,
        entry,
        bytes: utf8ByteLength(entry.model.getValue()),
      }))
      .sort(
        (a, b) =>
          a.entry.lastUsed - b.entry.lastUsed || a.uri.localeCompare(b.uri),
      )

    let count = candidates.length
    let bytes = candidates.reduce((sum, candidate) => sum + candidate.bytes, 0)
    const evicted: string[] = []
    for (const candidate of candidates) {
      if (
        count <= this.maxClosedCleanModels &&
        bytes <= this.maxClosedCleanBytes
      ) {
        break
      }
      this.disposeEntry(candidate.uri, candidate.entry)
      evicted.push(candidate.uri)
      count--
      bytes -= candidate.bytes
    }
    return evicted
  }

  saveViewState(
    editorId: string,
    uri: string,
    state: monaco.editor.ICodeEditorViewState | null,
  ): void {
    this.viewStates.set(viewStateKey(editorId, this.canonicalKey(uri)), state)
  }

  restoreViewState(
    editorId: string,
    uri: string,
  ): monaco.editor.ICodeEditorViewState | null | undefined {
    return this.viewStates.get(viewStateKey(editorId, this.canonicalKey(uri)))
  }

  getOrCreateDiffPair(
    baseUri: string,
    originalContent: string,
    modifiedContent: string,
    languageId: string,
  ): { original: monaco.editor.ITextModel; modified: monaco.editor.ITextModel } {
    const originalUri = this.diffOriginalUri(baseUri)
    const modifiedUri = this.diffModifiedUri(baseUri)
    return {
      original: this.getOrCreate(originalUri, originalContent, languageId),
      modified: this.getOrCreate(modifiedUri, modifiedContent, languageId),
    }
  }

  /** Force-dispose a model regardless of owners or pinning (used in tests). */
  dispose(uri: string): void {
    const key = this.canonicalKey(uri)
    const entry = this.models.get(key)
    if (entry) this.disposeEntry(key, entry)
  }

  /** @internal Compatibility alias for ownerCount. */
  refCount(uri: string): number {
    return this.ownerCount(uri)
  }

  /** Read-only, JSON-serializable model snapshot for the agent benchmark bridge. */
  diagnostics(): MonacoModelDiagnostic[] {
    return [...this.models.entries()]
      .map(([uri, entry]) => {
        const content = entry.model.getValue()
        const owners = [...entry.owners].sort()
        return {
          uri,
          refCount: owners.length,
          ownerCount: owners.length,
          owners,
          lspOwnerCount: owners.filter(owner => owner.startsWith("lsp:"))
            .length,
          open: entry.open,
          dirty: entry.dirty,
          pinned: entry.open || entry.dirty,
          lastUsed: entry.lastUsed,
          version: entry.model.getVersionId(),
          bytes: utf8ByteLength(content),
          lines: entry.model.getLineCount(),
          content,
        }
      })
      .sort((a, b) => a.uri.localeCompare(b.uri))
  }

  private nextAccess(): number {
    this.accessClock += 1
    return this.accessClock
  }

  private touch(entry: ModelEntry): void {
    entry.lastUsed = this.nextAccess()
  }

  private isClosedClean(entry: ModelEntry): boolean {
    return entry.owners.size === 0 && !entry.open && !entry.dirty
  }

  private disposeEntry(uri: string, entry: ModelEntry): void {
    entry.model.dispose()
    this.models.delete(uri)
  }
}

export const monacoModels = new MonacoModelRegistry()
