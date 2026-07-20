import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { autocompletion } from "@codemirror/autocomplete"
import { EditorState } from "@codemirror/state"
import { LSPClient, serverCompletionSource } from "@codemirror/lsp-client"
import { jetLanguageServerExtensions } from "./lsp-extensions.js"

type LspClientInternals = { extensions: unknown[] }

function collectedExtensionCount(
  extensions: ReturnType<typeof jetLanguageServerExtensions>,
): number {
  const client = new LSPClient({ extensions }) as unknown as LspClientInternals
  return client.extensions.length
}

describe("jetLanguageServerExtensions", () => {
  it("registers all editor extensions with LSPClient", () => {
    assert.equal(collectedExtensionCount(jetLanguageServerExtensions()), 4)
  })

  it("documents that bare languageData FacetProvider is dropped by LSPClient", () => {
    const client = new LSPClient({
      extensions: [
        EditorState.languageData.of(() => [{ autocomplete: serverCompletionSource }]),
      ],
    }) as unknown as LspClientInternals
    assert.equal(client.extensions.length, 0)
  })

  it("exposes serverCompletionSource in editor languageData via client.plugin()", () => {
    const client = new LSPClient({ extensions: jetLanguageServerExtensions() })
    const state = EditorState.create({
      doc: "const ipcMain = null\n",
      extensions: [
        autocompletion({ activateOnTyping: true, defaultKeymap: false }),
        client.plugin("file:///test.ts", "typescript"),
      ],
    })
    const sources = state.languageDataAt("autocomplete", 1)
    assert.ok(
      sources.some(source => source === serverCompletionSource),
      "serverCompletionSource must be available to autocompletion",
    )
  })
})
