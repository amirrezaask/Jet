import { afterEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { pathToFileUri } from "@yaade/shared"
import {
  LspFramingDecoder,
  encodeLspMessage,
  getLspSession,
  setLspCrashHandler,
  startLspSession,
  stopAllLspSessions,
  createLspRestartHelper,
} from "./lsp-bridge.js"
import { resetLanguageServerRegistryForTests } from "./lsp-registry.js"

afterEach(() => {
  stopAllLspSessions()
  setLspCrashHandler(() => {})
  resetLanguageServerRegistryForTests()
})

describe("LspFramingDecoder", () => {
  it("decodes messages when UTF-8 is split across chunks", () => {
    const decoder = new LspFramingDecoder()
    const body = JSON.stringify({
      jsonrpc: "2.0",
      result: { items: [{ label: "café", detail: "日本語" }] },
      id: 1,
    })
    const bytes = Buffer.from(encodeLspMessage(body), "utf8")
    const split = Math.floor(bytes.length / 2)

    const messages = [
      ...decoder.feed(bytes.subarray(0, split)),
      ...decoder.feed(bytes.subarray(split)),
    ]

    assert.equal(messages.length, 1)
    const parsed = JSON.parse(messages[0]!) as {
      result: { items: { label: string; detail: string }[] }
    }
    assert.equal(parsed.result.items[0]!.label, "café")
    assert.equal(parsed.result.items[0]!.detail, "日本語")
  })

  it("uses Content-Length as bytes, not UTF-16 code units", () => {
    const decoder = new LspFramingDecoder()
    const body = JSON.stringify({ x: "é".repeat(10) })
    const messages = decoder.feed(Buffer.from(encodeLspMessage(body), "utf8"))

    assert.equal(messages.length, 1)
    assert.equal(JSON.parse(messages[0]!).x.length, 10)
  })

  it("resets on absurd Content-Length instead of buffering forever", () => {
    const decoder = new LspFramingDecoder()
    const header = Buffer.from("Content-Length: 999999999\r\n\r\n", "utf8")
    const messages = decoder.feed(header)
    assert.equal(messages.length, 0)
    // Subsequent valid frame still works after reset.
    const body = JSON.stringify({ ok: true })
    const next = decoder.feed(Buffer.from(encodeLspMessage(body), "utf8"))
    assert.equal(next.length, 1)
    assert.equal(JSON.parse(next[0]!).ok, true)
  })
})

describe("startLspSession", () => {
  it("rejects unknown server ids without spawning", async () => {
    const rootUri = pathToFileUri(os.tmpdir())
    const result = await startLspSession({
      rootUri,
      serverId: "not-a-real-server",
    })
    assert.match(result.error ?? "", /Unknown language server/)
    assert.equal(result.id, "")
    assert.equal(result.transportUrl, "")
  })

  it("rejects paths outside allowed roots", async () => {
    const rootUri = pathToFileUri("/definitely-not-allowed-root")
    const result = await startLspSession({
      rootUri,
      serverId: "typescript-language-server",
      allowedRoots: [path.join(os.tmpdir(), "yaade-lsp-allowed")],
    })
    assert.match(result.error ?? "", /not allowed/i)
  })

  it("starts mock server when YAADE_LSP_MOCK=1", async () => {
    const mockScript = path.join(os.tmpdir(), `yaade-mock-lsp-${Date.now()}.sh`)
    const { writeFileSync } = await import("node:fs")
    writeFileSync(
      mockScript,
      '#!/bin/sh\nwhile IFS= read -r line; do :; done\n',
      { mode: 0o755 },
    )

    const prevMock = process.env.YAADE_LSP_MOCK
    const prevBin = process.env.YAADE_LSP_MOCK_BIN
    process.env.YAADE_LSP_MOCK = "1"
    process.env.YAADE_LSP_MOCK_BIN = mockScript
    resetLanguageServerRegistryForTests()

    try {
      const rootUri = pathToFileUri(os.tmpdir())
      const result = await startLspSession({
        rootUri,
        serverId: "mock-language-server",
        allowedRoots: [os.tmpdir()],
      })
      assert.equal(result.error, undefined, result.error)
      assert.ok(result.id.startsWith("lsp-mock-language-server-"))
      assert.match(result.transportUrl, /^ws:\/\/127\.0\.0\.1:\d+$/)
    } finally {
      if (prevMock === undefined) delete process.env.YAADE_LSP_MOCK
      else process.env.YAADE_LSP_MOCK = prevMock
      if (prevBin === undefined) delete process.env.YAADE_LSP_MOCK_BIN
      else process.env.YAADE_LSP_MOCK_BIN = prevBin
      resetLanguageServerRegistryForTests()
    }
  })

  it("cleans up and reports a server that exits successfully but unexpectedly", async () => {
    const mockScript = path.join(os.tmpdir(), `yaade-exiting-lsp-${Date.now()}.sh`)
    const { writeFileSync } = await import("node:fs")
    writeFileSync(mockScript, "#!/bin/sh\nexit 0\n", { mode: 0o755 })

    const prevMock = process.env.YAADE_LSP_MOCK
    const prevBin = process.env.YAADE_LSP_MOCK_BIN
    process.env.YAADE_LSP_MOCK = "1"
    process.env.YAADE_LSP_MOCK_BIN = mockScript
    resetLanguageServerRegistryForTests()

    try {
      const crashed = new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("timed out waiting for LSP exit")),
          2_000,
        )
        setLspCrashHandler(id => {
          clearTimeout(timeout)
          resolve(id)
        })
      })
      const result = await startLspSession({
        rootUri: pathToFileUri(os.tmpdir()),
        serverId: "mock-language-server",
        allowedRoots: [os.tmpdir()],
      })

      assert.equal(await crashed, result.id)
      assert.equal(getLspSession(result.id), undefined)
    } finally {
      if (prevMock === undefined) delete process.env.YAADE_LSP_MOCK
      else process.env.YAADE_LSP_MOCK = prevMock
      if (prevBin === undefined) delete process.env.YAADE_LSP_MOCK_BIN
      else process.env.YAADE_LSP_MOCK_BIN = prevBin
      resetLanguageServerRegistryForTests()
    }
  })
})

describe("createLspRestartHelper", () => {
  it("caps restart attempts", () => {
    const helper = createLspRestartHelper({ maxAttempts: 2, delayMs: 100 })
    assert.equal(helper.shouldRestart("s1"), true)
    assert.equal(helper.shouldRestart("s1"), true)
    assert.equal(helper.shouldRestart("s1"), false)
    helper.reset("s1")
    assert.equal(helper.shouldRestart("s1"), true)
  })
})
