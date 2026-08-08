import { afterEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  getLanguageServerDefinition,
  listLanguageServerDefinitions,
  resetLanguageServerRegistryForTests,
  resolveLanguageServerCommand,
  serverIdForLanguage,
} from "./lsp-registry.js"

const originalMockEnv = process.env.YAADE_LSP_MOCK
const originalMockBin = process.env.YAADE_LSP_MOCK_BIN

afterEach(() => {
  if (originalMockEnv === undefined) delete process.env.YAADE_LSP_MOCK
  else process.env.YAADE_LSP_MOCK = originalMockEnv
  if (originalMockBin === undefined) delete process.env.YAADE_LSP_MOCK_BIN
  else process.env.YAADE_LSP_MOCK_BIN = originalMockBin
  resetLanguageServerRegistryForTests()
})

describe("lsp-registry", () => {
  it("maps language ids to server ids", () => {
    assert.equal(serverIdForLanguage("typescript"), "typescript-language-server")
    assert.equal(serverIdForLanguage("javascript"), "typescript-language-server")
    assert.equal(serverIdForLanguage("go"), "gopls")
    assert.equal(serverIdForLanguage("rust"), "rust-analyzer")
    assert.equal(serverIdForLanguage("python"), "pyright")
    assert.equal(serverIdForLanguage("ruby"), "ruby-lsp")
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

    const py = getLanguageServerDefinition("pyright")
    assert.ok(py)
    assert.ok(py!.rootMarkers.includes("setup.py"))
    assert.ok(py!.rootMarkers.includes("Pipfile"))

    const ruby = getLanguageServerDefinition("ruby-lsp")
    assert.ok(ruby)
    assert.deepEqual(ruby!.args, [])
    assert.deepEqual(ruby!.candidateArgs?.solargraph, ["stdio"])
    assert.ok(ruby!.rootMarkers.includes("Gemfile"))
  })

  it("rejects unknown server ids", () => {
    assert.equal(getLanguageServerDefinition("evil-binary"), undefined)
    const resolved = resolveLanguageServerCommand({
      id: "evil-binary",
      languages: [],
      commandCandidates: ["__yaade_definitely_not_on_path__"],
      args: ["--stdio"],
      environment: {},
      candidateArgs: {},
      rootMarkers: [],
      priority: 0,
      enabled: true,
    })
    assert.ok("error" in resolved)
  })

  it("includes mock server only when YAADE_LSP_MOCK=1", () => {
    delete process.env.YAADE_LSP_MOCK
    resetLanguageServerRegistryForTests()
    assert.equal(
      listLanguageServerDefinitions().some(d => d.id === "mock-language-server"),
      false,
    )

    process.env.YAADE_LSP_MOCK = "1"
    process.env.YAADE_LSP_MOCK_BIN = "/tmp/yaade-mock-lsp"
    resetLanguageServerRegistryForTests()
    const mock = getLanguageServerDefinition("mock-language-server")
    assert.ok(mock)
    assert.deepEqual(mock!.commandCandidates, ["/tmp/yaade-mock-lsp"])
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

  it("supports an explicit per-server binary override", () => {
    const key = "YAADE_LSP_GOPLS_BIN"
    const previous = process.env[key]
    process.env[key] = process.execPath
    try {
      const def = getLanguageServerDefinition("gopls")
      assert.ok(def)
      const resolved = resolveLanguageServerCommand(def)
      assert.ok(!("error" in resolved))
      assert.equal(resolved.command, process.execPath)
      assert.deepEqual(resolved.args, ["serve"])
    } finally {
      if (previous === undefined) delete process.env[key]
      else process.env[key] = previous
    }
  })
})
