import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js"
import { canonicalizeFileUri } from "@yaade/shared"
import { monacoLanguageId } from "./language.js"
import { setModelLanguage } from "./model-language.js"

export const DIFF_ORIGINAL_SCHEME = "yaade-diff-original"
export const DIFF_MODIFIED_SCHEME = "yaade-diff-modified"

type ModelEntry = {
  model: monaco.editor.ITextModel
  refCount: number
}

export type MonacoModelDiagnostic = {
  uri: string
  refCount: number
  /** Current refcount-derived owner total; explicit owner kinds are not tracked yet. */
  ownerCount: number
  /** Explicit LSP ownership is not tracked by the current registry. */
  lspOwnerCount: null
  version: number
  bytes: number
  lines: number
  content: string
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
  private readonly viewStates = new Map<ViewStateKey, monaco.editor.ICodeEditorViewState | null>()

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
    return this.models.get(this.canonicalKey(uri))?.model
  }

  getOrCreate(uri: string, content: string, languageId: string): monaco.editor.ITextModel {
    const key = this.canonicalKey(uri)
    const existing = this.models.get(key)
    if (existing) {
      existing.refCount++
      return existing.model
    }

    const model = monaco.editor.createModel(content, monacoLanguageId(languageId), monaco.Uri.parse(key))
    this.models.set(key, { model, refCount: 1 })
    return model
  }

  acquire(uri: string): monaco.editor.ITextModel | undefined {
    const key = this.canonicalKey(uri)
    const entry = this.models.get(key)
    if (!entry) return undefined
    entry.refCount++
    return entry.model
  }

  release(uri: string): void {
    const key = this.canonicalKey(uri)
    const entry = this.models.get(key)
    if (!entry) return
    entry.refCount = Math.max(0, entry.refCount - 1)
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
      model.pushEditOperations([], [{ range: fullRange, text: content }], () => null)
    } else {
      model.setValue(content)
    }
    return true
  }

  disposeIfUnreferenced(uri: string, canDispose?: (uri: string) => boolean): boolean {
    const key = this.canonicalKey(uri)
    const entry = this.models.get(key)
    if (!entry || entry.refCount > 0) return false
    if (canDispose && !canDispose(key)) return false
    entry.model.dispose()
    this.models.delete(key)
    for (const stateKey of [...this.viewStates.keys()]) {
      if (stateKey.endsWith(`\0${key}`)) this.viewStates.delete(stateKey)
    }
    return true
  }

  saveViewState(editorId: string, uri: string, state: monaco.editor.ICodeEditorViewState | null): void {
    this.viewStates.set(viewStateKey(editorId, this.canonicalKey(uri)), state)
  }

  restoreViewState(editorId: string, uri: string): monaco.editor.ICodeEditorViewState | null | undefined {
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

  /** Force-dispose a model regardless of refcount (used in tests). */
  dispose(uri: string): void {
    const key = this.canonicalKey(uri)
    const entry = this.models.get(key)
    if (!entry) return
    entry.model.dispose()
    this.models.delete(key)
  }

  /** @internal Test helper — current refcount for a URI. */
  refCount(uri: string): number {
    return this.models.get(this.canonicalKey(uri))?.refCount ?? 0
  }

  /** Read-only, JSON-serializable model snapshot for the agent benchmark bridge. */
  diagnostics(): MonacoModelDiagnostic[] {
    return [...this.models.entries()]
      .map(([uri, entry]) => {
        const content = entry.model.getValue()
        return {
          uri,
          refCount: entry.refCount,
          ownerCount: entry.refCount,
          lspOwnerCount: null,
          version: entry.model.getVersionId(),
          bytes: utf8ByteLength(content),
          lines: entry.model.getLineCount(),
          content,
        }
      })
      .sort((a, b) => a.uri.localeCompare(b.uri))
  }
}

export const monacoModels = new MonacoModelRegistry()
