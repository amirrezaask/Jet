import { before, describe, it, beforeEach, afterEach, mock } from "node:test"
import assert from "node:assert/strict"

type MockModel = {
  uri: { toString: () => string }
  languageId: string
  value: string
  disposed: boolean
  getValue: () => string
  setValue: (v: string) => void
  getLanguageId: () => string
  getPositionAt: (offset: number) => { lineNumber: number; column: number }
  getFullModelRange: () => {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }
  pushEditOperations: (
    before: unknown[],
    edits: { range: unknown; text: string }[],
    cursor: () => null,
  ) => void
  dispose: () => void
}

const liveModels = new Map<string, MockModel>()

function createMockModel(uri: string, content: string, languageId: string): MockModel {
  const model: MockModel = {
    uri: { toString: () => uri },
    languageId,
    value: content,
    disposed: false,
    getValue() {
      return this.value
    },
    setValue(v: string) {
      this.value = v
    },
    getLanguageId() {
      return this.languageId
    },
    getPositionAt(offset) {
      return { lineNumber: 1, column: offset + 1 }
    },
    getFullModelRange() {
      return { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }
    },
    pushEditOperations(_before, edits) {
      for (const edit of edits) {
        this.value = edit.text
      }
    },
    dispose() {
      this.disposed = true
      liveModels.delete(uri)
    },
  }
  liveModels.set(uri, model)
  return model
}

const monacoMock = {
  editor: {
    createModel(content: string, languageId: string, uri: { toString: () => string }) {
      return createMockModel(uri.toString(), content, languageId)
    },
    setModelLanguage(model: MockModel, languageId: string) {
      model.languageId = languageId
    },
    getModel() {
      return undefined
    },
    setModelMarkers() {},
  },
  Uri: {
    parse(value: string) {
      return { toString: () => value }
    },
  },
}

mock.module("monaco-editor/esm/vs/editor/editor.api.js", {
  namedExports: {
    editor: monacoMock.editor,
    Uri: monacoMock.Uri,
  },
  defaultExport: monacoMock,
})

describe("MonacoModelRegistry", () => {
  let MonacoModelRegistry: typeof import("./model-registry.js").MonacoModelRegistry
  let applyWorkspaceEdit: typeof import("./apply-edit.js").applyWorkspaceEdit
  let registry: InstanceType<typeof MonacoModelRegistry>
  const uri = "file:///tmp/test-registry.ts"

  before(async () => {
    const registryModule = await import("./model-registry.js")
    const editModule = await import("./apply-edit.js")
    MonacoModelRegistry = registryModule.MonacoModelRegistry
    applyWorkspaceEdit = editModule.applyWorkspaceEdit
  })

  beforeEach(() => {
    liveModels.clear()
    registry = new MonacoModelRegistry()
  })

  afterEach(() => {
    if (registry.has(uri)) registry.dispose(uri)
    const originalUri = registry.diffOriginalUri(uri)
    const modifiedUri = registry.diffModifiedUri(uri)
    if (registry.has(originalUri)) registry.dispose(originalUri)
    if (registry.has(modifiedUri)) registry.dispose(modifiedUri)
  })

  it("creates and reuses models with refcounting", () => {
    const model1 = registry.getOrCreate(uri, "hello", "typescript")
    assert.equal(registry.refCount(uri), 1)
    assert.equal(model1.getValue(), "hello")

    const model2 = registry.acquire(uri)
    assert.equal(model2, model1)
    assert.equal(registry.refCount(uri), 2)

    registry.release(uri)
    assert.equal(registry.refCount(uri), 1)
    assert.ok(registry.has(uri))
  })

  it("disposes when unreferenced", () => {
    const model = registry.getOrCreate(uri, "content", "typescript")
    registry.release(uri)
    assert.equal(registry.disposeIfUnreferenced(uri), true)
    assert.equal(registry.has(uri), false)
    assert.equal(model.disposed, true)
  })

  it("respects canDispose callback", () => {
    registry.getOrCreate(uri, "dirty", "typescript")
    registry.release(uri)
    const disposed = registry.disposeIfUnreferenced(uri, () => false)
    assert.equal(disposed, false)
    assert.ok(registry.has(uri))
  })

  it("updates content with and without preserveCursor", () => {
    registry.getOrCreate(uri, "old", "typescript")
    registry.updateContent(uri, "new")
    assert.equal(registry.getContent(uri), "new")

    registry.updateContent(uri, "newer", { preserveCursor: true })
    assert.equal(registry.getContent(uri), "newer")
  })

  it("sets language on existing model", () => {
    const model = registry.getOrCreate(uri, "const x = 1", "typescript")
    registry.setLanguage(uri, "javascript")
    assert.equal(model.getLanguageId(), "javascript")
  })

  it("saves and restores view state", () => {
    const state = {
      contributionsState: {},
      viewState: {
        scrollLeft: 10,
        firstPosition: { lineNumber: 2, column: 1 },
        firstPositionDeltaTop: 0,
      },
    }
    registry.saveViewState("editor-1", uri, state)
    const restored = registry.restoreViewState("editor-1", uri)
    assert.deepEqual(restored, state)
  })

  it("creates diff model pair with custom schemes", () => {
    const pair = registry.getOrCreateDiffPair(uri, "old line", "new line", "typescript")
    assert.equal(pair.original.getValue(), "old line")
    assert.equal(pair.modified.getValue(), "new line")
    assert.ok(pair.original.uri.toString().startsWith("gharargah-diff-original:"))
    assert.ok(pair.modified.uri.toString().startsWith("gharargah-diff-modified:"))
    registry.release(registry.diffOriginalUri(uri))
    registry.release(registry.diffModifiedUri(uri))
  })

  it("canonicalizes file URIs", () => {
    const testUri = "file:///tmp/registry-canonical.ts"
    const model = registry.getOrCreate(testUri, "a", "typescript")
    assert.equal(registry.get(testUri), model)
    registry.release(testUri)
    registry.disposeIfUnreferenced(testUri)
  })

  it("rejects an atomic multi-document edit before mutating any model", () => {
    const otherUri = "file:///tmp/test-registry-other.ts"
    registry.getOrCreate(uri, "alpha", "typescript")
    registry.getOrCreate(otherUri, "beta", "typescript")

    const result = applyWorkspaceEdit(
      {
        documentChanges: [
          {
            textDocument: { uri, version: 1 },
            edits: [{
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
              newText: "changed-alpha",
            }],
          },
          {
            textDocument: { uri: otherUri, version: 99 },
            edits: [{
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
              newText: "changed-beta",
            }],
          },
        ],
      },
      {
        registry,
        isDirty: () => false,
        getVersion: target => target === otherUri ? 2 : 1,
        atomic: true,
      },
    )

    assert.equal(result.applied.length, 0)
    assert.equal(result.skipped.length, 1)
    assert.equal(registry.getContent(uri), "alpha")
    assert.equal(registry.getContent(otherUri), "beta")
    registry.dispose(otherUri)
  })

  it("can apply a synced rename edit to an unsaved model when explicitly allowed", () => {
    registry.getOrCreate(uri, "alpha", "typescript")
    const result = applyWorkspaceEdit(
      {
        changes: {
          [uri]: [{
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
            newText: "renamed",
          }],
        },
      },
      {
        registry,
        isDirty: () => true,
        allowDirty: true,
        atomic: true,
      },
    )

    assert.deepEqual(result.applied, [uri])
    assert.equal(result.skipped.length, 0)
    assert.equal(registry.getContent(uri), "renamed")
  })
})
