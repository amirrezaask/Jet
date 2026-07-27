import { afterEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  getLanguageServerDefinition,
  listLanguageServerDefinitions,
  resetLanguageServerRegistryForTests,
  resolveLanguageServerCommand,
  serverIdForLanguage,
} from "./lsp-registry.js"

const originalMockEnv = process.env.GHARARGAH_LSP_MOCK
const originalMockBin = process.env.GHARARGAH_LSP_MOCK_BIN

afterEach(() => {
  if (originalMockEnv === undefined) delete process.env.GHARARGAH_LSP_MOCK
  else process.env.GHARARGAH_LSP_MOCK = originalMockEnv
  if (originalMockBin === undefined) delete process.env.GHARARGAH_LSP_MOCK_BIN
  else process.env.GHARARGAH_LSP_MOCK_BIN = originalMockBin
  resetLanguageServerRegistryForTests()
})

describe("lsp-registry", () => {
  it("maps language ids to server ids", () => {
    assert.equal(serverIdForLanguage("typescript"), "typescript-language-server")
    assert.equal(serverIdForLanguage("javascript"), "typescript-language-server")
    assert.equal(serverIdForLanguage("go"), "gopls")
    assert.equal(serverIdForLanguage("rust"), "rust-analyzer")
    assert.equal(serverIdForLanguage("python"), "pyright")
    assert.equal(serverIdForLanguage("json"), "vscode-json-language-server")
    assert.equal(serverIdForLanguage("html"), "vscode-html-language-server")
    assert.equal(serverIdForLanguage("css"), "vscode-css-language-server")
    assert.equal(serverIdForLanguage("unknown-lang"), null)
  })

  it("returns definitions with expected args", () => {
    const ts = getLanguageServerDefinition("typescript-language-server")
    assert.ok(ts)
    assert.deepEqual(ts!.args, ["--stdio"])
    assert.ok(ts!.rootMarkers.includes("tsconfig.json"))

    const ra = getLanguageServerDefinition("rust-analyzer")
    assert.ok(ra)
    assert.deepEqual(ra!.args, [])
  })

  it("rejects unknown server ids", () => {
    assert.equal(getLanguageServerDefinition("evil-binary"), undefined)
    const resolved = resolveLanguageServerCommand({
      id: "evil-binary",
      languages: [],
      commandCandidates: ["__gharargah_definitely_not_on_path__"],
      args: ["--stdio"],
      rootMarkers: [],
    })
    assert.ok("error" in resolved)
  })

  it("includes mock server only when GHARARGAH_LSP_MOCK=1", () => {
    delete process.env.GHARARGAH_LSP_MOCK
    resetLanguageServerRegistryForTests()
    assert.equal(
      listLanguageServerDefinitions().some(d => d.id === "mock-language-server"),
      false,
    )

    process.env.GHARARGAH_LSP_MOCK = "1"
    process.env.GHARARGAH_LSP_MOCK_BIN = "/tmp/gharargah-mock-lsp"
    resetLanguageServerRegistryForTests()
    const mock = getLanguageServerDefinition("mock-language-server")
    assert.ok(mock)
    assert.deepEqual(mock!.commandCandidates, ["/tmp/gharargah-mock-lsp"])
    assert.equal(serverIdForLanguage("mock"), "mock-language-server")
  })

  it("resolveLanguageServerCommand finds node on PATH", () => {
    const def = getLanguageServerDefinition("typescript-language-server")
    assert.ok(def)
    const resolved = resolveLanguageServerCommand(def!)
    if ("error" in resolved) {
      assert.match(resolved.error, /No executable found/)
      return
    }
    assert.ok(resolved.command.length > 0)
    assert.deepEqual(resolved.args, ["--stdio"])
  })
})
