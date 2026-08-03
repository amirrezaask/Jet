import assert from "node:assert/strict"
import { test } from "node:test"
import type { ServerCapabilities } from "vscode-languageserver-protocol"

import { serverSupports } from "./server-capabilities.js"

test("gates Monaco providers on the server's declared capabilities", () => {
  const capabilities: ServerCapabilities = {
    documentSymbolProvider: true,
    codeActionProvider: { codeActionKinds: ["quickfix"] },
    semanticTokensProvider: {
      legend: { tokenTypes: ["variable"], tokenModifiers: [] },
      full: true,
    },
    inlayHintProvider: true,
    documentRangeFormattingProvider: true,
    documentHighlightProvider: true,
    codeLensProvider: { resolveProvider: true },
  }

  for (const method of [
    "textDocument/documentSymbol",
    "textDocument/codeAction",
    "textDocument/semanticTokens/full",
    "textDocument/inlayHint",
    "textDocument/rangeFormatting",
    "textDocument/documentHighlight",
    "textDocument/codeLens",
  ]) assert.equal(serverSupports(capabilities, method), true, method)

  assert.equal(serverSupports({ semanticTokensProvider: {
    legend: { tokenTypes: [], tokenModifiers: [] },
    range: true,
  } }, "textDocument/semanticTokens/full"), false)
  assert.equal(serverSupports(capabilities, "textDocument/callHierarchy"), false)
})
