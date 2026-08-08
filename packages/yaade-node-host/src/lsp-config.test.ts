import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"
import {
  loadLanguageServerConfig,
  parseLanguageServerConfig,
  redactConfiguredEnvironment,
} from "./lsp-config.js"

describe("language server global configuration", () => {
  it("validates and orders global definitions while retaining built-ins", () => {
    const result = parseLanguageServerConfig(
      JSON.stringify({
        languageServers: [
          {
            id: "acme-lsp",
            languages: ["acme"],
            commandCandidates: ["acme-lsp"],
            args: ["--stdio"],
            environment: { ACME_TOKEN: "top-secret" },
            rootMarkers: ["acme.json", ".acme/project"],
            priority: 50,
            initializationOptions: { mode: "fast" },
            settings: { acme: { lint: true } },
          },
        ],
      }),
      {},
    )

    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.catalog.definitions[0]?.id, "acme-lsp")
    assert.ok(result.catalog.definitions.some(definition => definition.id === "gopls"))
    const definition = result.catalog.definitions[0]
    assert.deepEqual(definition?.rootMarkers, ["acme.json", ".acme/project"])
    assert.deepEqual(definition?.settings, { acme: { lint: true } })
  })

  it("rejects invalid commands and marker traversal", () => {
    const emptyCommand = parseLanguageServerConfig(
      JSON.stringify({
        languageServers: [{ id: "bad", languages: ["bad"], commandCandidates: [] }],
      }),
      {},
    )
    assert.equal(emptyCommand.ok, false)

    const escapingMarker = parseLanguageServerConfig(
      JSON.stringify({
        languageServers: [{
          id: "bad",
          languages: ["bad"],
          commandCandidates: ["bad-lsp"],
          rootMarkers: ["../outside"],
        }],
      }),
      {},
    )
    assert.equal(escapingMarker.ok, false)
  })

  it("loads built-ins when yaaderc.json does not exist", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "yaade-lsp-config-"))
    try {
      const result = await loadLanguageServerConfig(home, {})
      assert.equal(result.ok, true)
      if (!result.ok) return
      assert.ok(result.catalog.definitions.some(definition => definition.id === "rust-analyzer"))
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
    }
  })

  it("redacts every configured environment value from logs", () => {
    const message = "request token=top-secret endpoint=https://secret.invalid token=top-secret"
    assert.equal(
      redactConfiguredEnvironment(message, {
        TOKEN: "top-secret",
        ENDPOINT: "https://secret.invalid",
      }),
      "request token=[redacted] endpoint=[redacted] token=[redacted]",
    )
  })
})
