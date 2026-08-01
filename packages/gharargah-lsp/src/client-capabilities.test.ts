import assert from "node:assert/strict"
import { test } from "node:test"

import { gharargahLspClientCapabilities } from "./client-capabilities.js"

test("advertises only semantic features implemented by the Monaco client", () => {
  const textDocument = gharargahLspClientCapabilities.textDocument

  assert.ok(textDocument.completion)
  assert.ok(textDocument.hover)
  assert.ok(textDocument.signatureHelp)
  assert.ok(textDocument.definition)
  assert.ok(textDocument.declaration)
  assert.ok(textDocument.typeDefinition)
  assert.ok(textDocument.implementation)
  assert.ok(textDocument.references)
  assert.ok(textDocument.rename)
  assert.ok(textDocument.formatting)
  assert.ok(textDocument.rangeFormatting)
  assert.ok(textDocument.documentSymbol)
  assert.ok(textDocument.codeAction)
  assert.ok(textDocument.semanticTokens)
  assert.ok(textDocument.inlayHint)
  assert.ok(textDocument.documentHighlight)
  assert.ok(textDocument.codeLens)
  assert.ok(textDocument.publishDiagnostics)

  assert.equal("rangeSemanticTokens" in textDocument, false)
  assert.equal("onTypeFormatting" in textDocument, false)
  assert.equal("callHierarchy" in textDocument, false)
})
