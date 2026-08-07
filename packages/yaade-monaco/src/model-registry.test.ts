import { before, describe, it, beforeEach, afterEach, mock } from "node:test"
import assert from "node:assert/strict"

type MockModel = {
  uri: { toString: () => string }
  languageId: string
  value: string
  disposed: boolean
  getValue: () => string
  getVersionId: () => number
  getLineCount: () => number
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
    getVersionId() {
      return 1
    },
    getLineCount() {
      return this.value.split("\n").length
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
  let MAX_CLOSED_CLEAN_MODELS: number
  let MAX_CLOSED_CLEAN_BYTES: number
  let applyWorkspaceEdit: typeof import("./apply-edit.js").applyWorkspaceEdit
  let registry: InstanceType<typeof MonacoModelRegistry>
  const uri = "file:///tmp/test-registry.ts"

  before(async () => {
    const registryModule = await import("./model-registry.js")
    const editModule = await import("./apply-edit.js")
    MonacoModelRegistry = registryModule.MonacoModelRegistry
    MAX_CLOSED_CLEAN_MODELS = registryModule.MAX_CLOSED_CLEAN_MODELS
    MAX_CLOSED_CLEAN_BYTES = registryModule.MAX_CLOSED_CLEAN_BYTES
    applyWorkspaceEdit = editModule.applyWorkspaceEdit
  })

  beforeEach(() => {
    liveModels.clear()
    registry = new MonacoModelRegistry()
  })

  it("uses the 20-model and 32 MiB closed-clean cache limits", () => {
    assert.equal(MAX_CLOSED_CLEAN_MODELS, 20)
    assert.equal(MAX_CLOSED_CLEAN_BYTES, 32 * 1024 * 1024)
  })

  afterEach(() => {
    if (registry.has(uri)) registry.dispose(uri)
    const originalUri = registry.diffOriginalUri(uri)
    const modifiedUri = registry.diffModifiedUri(uri)
    if (registry.has(originalUri)) registry.dispose(originalUri)
    if (registry.has(modifiedUri)) registry.dispose(modifiedUri)
  })

  it("creates and reuses models without implicit ownership", () => {
    const model1 = registry.getOrCreate(uri, "hello", "typescript")
    assert.equal(registry.ownerCount(uri), 0)
    assert.equal(model1.getValue(), "hello")

    const model2 = registry.getOrCreate(uri, "ignored", "typescript")
    assert.equal(model2, model1)
    assert.equal(registry.ownerCount(uri), 0)
  })

  it("reconciles independent buffer and view owners idempotently", () => {
    registry.getOrCreate(uri, "hello", "typescript")
    const bufferOwner = `buffer:${uri}`
    const viewOwner = "view:editor-1"

    registry.retain(uri, bufferOwner)
    registry.retain(uri, viewOwner)
    registry.retain(uri, viewOwner)

    assert.equal(registry.ownerCount(uri), 2)
    assert.deepEqual(registry.owners(uri), [bufferOwner, viewOwner])

    registry.release(uri, viewOwner)
    registry.release(uri, viewOwner)
    assert.equal(registry.ownerCount(uri), 1)
    assert.deepEqual(registry.owners(uri), [bufferOwner])

    registry.release(uri, bufferOwner)
    assert.equal(registry.ownerCount(uri), 0)
    assert.deepEqual(registry.owners(uri), [])
    assert.ok(registry.has(uri))
  })

  it("keeps compatibility acquire idempotent with an explicit owner", () => {
    registry.getOrCreate(uri, "hello", "typescript")
    registry.acquire(uri, "legacy:caller")
    registry.acquire(uri, "legacy:caller")
    assert.equal(registry.ownerCount(uri), 1)
    assert.deepEqual(registry.owners(uri), ["legacy:caller"])
    registry.release(uri, "legacy:caller")
    assert.equal(registry.ownerCount(uri), 0)
  })

  it("disposes when unreferenced", () => {
    const model = registry.getOrCreate(uri, "content", "typescript")
    assert.equal(registry.disposeIfUnreferenced(uri), true)
    assert.equal(registry.has(uri), false)
    assert.equal(model.disposed, true)
  })

  it("respects canDispose callback", () => {
    registry.getOrCreate(uri, "dirty", "typescript")
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

  it("preserves view state after closed-clean model eviction", () => {
    registry = new MonacoModelRegistry({ maxClosedCleanModels: 0 })
    const state = {
      contributionsState: {},
      viewState: {
        scrollLeft: 25,
        firstPosition: { lineNumber: 8, column: 3 },
        firstPositionDeltaTop: 4,
      },
    }
    registry.getOrCreate(uri, "content", "typescript")
    registry.saveViewState("editor-1", uri, state)
    assert.deepEqual(registry.evictClosedClean(), [uri])
    assert.equal(registry.has(uri), false)
    assert.deepEqual(registry.restoreViewState("editor-1", uri), state)
  })

  it("evicts closed-clean models by count in least-recently-used order", () => {
    registry = new MonacoModelRegistry({ maxClosedCleanModels: 2 })
    const first = "file:///tmp/lru-first.ts"
    const second = "file:///tmp/lru-second.ts"
    const third = "file:///tmp/lru-third.ts"
    registry.getOrCreate(first, "first", "typescript")
    registry.getOrCreate(second, "second", "typescript")
    registry.getOrCreate(third, "third", "typescript")
    registry.get(first)

    assert.deepEqual(registry.evictClosedClean(), [second])
    assert.equal(registry.has(first), true)
    assert.equal(registry.has(second), false)
    assert.equal(registry.has(third), true)
  })

  it("evicts closed-clean models by UTF-8 byte budget", () => {
    registry = new MonacoModelRegistry({
      maxClosedCleanModels: 20,
      maxClosedCleanBytes: 10,
    })
    const first = "file:///tmp/bytes-first.ts"
    const second = "file:///tmp/bytes-second.ts"
    registry.getOrCreate(first, "123456", "typescript")
    registry.getOrCreate(second, "abcdef", "typescript")

    assert.deepEqual(registry.evictClosedClean(), [first])
    assert.equal(registry.has(first), false)
    assert.equal(registry.has(second), true)
  })

  it("never evicts dirty, open, or owned models", () => {
    registry = new MonacoModelRegistry({ maxClosedCleanModels: 1 })
    const open = "file:///tmp/pinned-open.ts"
    const dirty = "file:///tmp/pinned-dirty.ts"
    const owned = "file:///tmp/pinned-owned.ts"
    const oldClean = "file:///tmp/old-clean.ts"
    const newClean = "file:///tmp/new-clean.ts"
    registry.getOrCreate(open, "open", "typescript")
    registry.setPinned(open, { open: true, dirty: false })
    registry.getOrCreate(dirty, "dirty", "typescript")
    registry.setPinned(dirty, { open: false, dirty: true })
    registry.getOrCreate(owned, "owned", "typescript")
    registry.retain(owned, "view:owned")
    registry.getOrCreate(oldClean, "old", "typescript")
    registry.getOrCreate(newClean, "new", "typescript")

    assert.deepEqual(registry.evictClosedClean(), [oldClean])
    assert.equal(registry.has(open), true)
    assert.equal(registry.has(dirty), true)
    assert.equal(registry.has(owned), true)
    assert.equal(registry.has(oldClean), false)
    assert.equal(registry.has(newClean), true)
    assert.deepEqual(registry.pinState(open), { open: true, dirty: false })
    assert.deepEqual(registry.pinState(dirty), { open: false, dirty: true })
  })

  it("returns view ownership to zero on detach without immediate eviction", () => {
    registry.getOrCreate(uri, "content", "typescript")
    registry.retain(uri, "view:editor-1")
    assert.equal(registry.ownerCount(uri), 1)
    registry.release(uri, "view:editor-1")
    assert.equal(registry.ownerCount(uri), 0)
    assert.equal(registry.has(uri), true)
  })

  it("creates diff model pair with custom schemes", () => {
    const pair = registry.getOrCreateDiffPair(uri, "old line", "new line", "typescript")
    assert.equal(pair.original.getValue(), "old line")
    assert.equal(pair.modified.getValue(), "new line")
    assert.ok(pair.original.uri.toString().startsWith("yaade-diff-original:"))
    assert.ok(pair.modified.uri.toString().startsWith("yaade-diff-modified:"))
    assert.equal(registry.ownerCount(registry.diffOriginalUri(uri)), 0)
    assert.equal(registry.ownerCount(registry.diffModifiedUri(uri)), 0)
  })

  it("canonicalizes file URIs", () => {
    const testUri = "file:///tmp/registry-canonical.ts"
    const model = registry.getOrCreate(testUri, "a", "typescript")
    assert.equal(registry.get(testUri), model)
    registry.disposeIfUnreferenced(testUri)
  })

  it("reports a read-only JSON model snapshot", () => {
    registry.getOrCreate(uri, "hello\n🌙", "typescript")
    registry.retain(uri, `buffer:${uri}`)
    registry.retain(uri, "lsp:typescript")
    registry.setPinned(uri, { open: true, dirty: true })
    assert.deepEqual(registry.diagnostics(), [
      {
        uri,
        refCount: 2,
        ownerCount: 2,
        owners: [`buffer:${uri}`, "lsp:typescript"],
        lspOwnerCount: 1,
        open: true,
        dirty: true,
        pinned: true,
        lastUsed: 4,
        version: 1,
        bytes: 10,
        lines: 2,
        content: "hello\n🌙",
      },
    ])
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
