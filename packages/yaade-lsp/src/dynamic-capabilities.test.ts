import assert from "node:assert/strict"
import { test } from "node:test"
import {
  connectionDocumentSelector,
  documentSelectorMatches,
  DynamicCapabilityStore,
  registrationDocumentSelector,
} from "./dynamic-capabilities.js"

test("dynamic registrations replace and dispose exactly by registration id", () => {
  const disposed: string[] = []
  const store = new DynamicCapabilityStore(registration => ({
    dispose: () => disposed.push(`${registration.id}:${registration.method}`),
  }))

  store.register([{ id: "one", method: "textDocument/foldingRange" }])
  store.register([{ id: "two", method: "textDocument/documentLink" }])
  store.register([{ id: "one", method: "textDocument/selectionRange" }])
  assert.deepEqual(disposed, ["one:textDocument/foldingRange"])
  assert.equal(store.size(), 2)

  store.unregister([{ id: "one", method: "textDocument/selectionRange" }])
  assert.deepEqual(disposed, [
    "one:textDocument/foldingRange",
    "one:textDocument/selectionRange",
  ])
  assert.equal(store.size(), 1)

  store.dispose()
  assert.deepEqual(disposed, [
    "one:textDocument/foldingRange",
    "one:textDocument/selectionRange",
    "two:textDocument/documentLink",
  ])
  assert.equal(store.size(), 0)
})

test("dynamic document selectors preserve language, scheme, and glob filters", () => {
  const fallback = connectionDocumentSelector(["tsx", "typescript", "jsx"])
  assert.deepEqual(fallback, ["typescript", "javascript"])
  assert.equal(registrationDocumentSelector({}, fallback), fallback)
  assert.deepEqual(
    registrationDocumentSelector({
      documentSelector: [
        { language: "tsx", scheme: "file", pattern: "**/*.tsx" },
        "jsx",
        { notebook: "jupyter-notebook", language: "python" },
        { language: "rust", pattern: { baseUri: "file:///", pattern: "**/*.rs" } },
      ],
    }, fallback),
    [
      { language: "typescript", scheme: "file", pattern: "**/*.tsx" },
      "javascript",
    ],
  )
  assert.deepEqual(
    registrationDocumentSelector({ documentSelector: [] }, fallback),
    [],
  )
})

test("dynamic document selectors gate protocol-only registrations", () => {
  const selector = registrationDocumentSelector({
    documentSelector: [{ language: "tsx", scheme: "file", pattern: "workspace/**/*.tsx" }],
  }, [])
  assert.equal(documentSelectorMatches(
    selector,
    "file:///workspace/src/App.tsx",
    "typescript",
  ), true)
  assert.equal(documentSelectorMatches(selector, "untitled:App.tsx", "typescript"), false)
  assert.equal(documentSelectorMatches(selector, "file:///workspace/src/App.ts", "typescript"), false)
})
