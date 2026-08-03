import { expect, test } from "@playwright/test"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"

import { expectSelectorVisible } from "../shell/assert.js"
import { execCommand, hasPtySpawn, launchJet } from "./_launch.js"

const ptyAvailable = hasPtySpawn()

function createMockGopls(): { binDir: string; tracePath: string; remove(): void } {
  const dir = mkdtempSync(join(tmpdir(), "yaade-gopls-"))
  const binDir = join(dir, "bin")
  const tracePath = join(dir, "trace.jsonl")
  mkdirSync(binDir)
  const executable = join(binDir, process.platform === "win32" ? "gopls.cmd" : "gopls")
  const script = `#!/usr/bin/env node
const fs = require("node:fs")
const tracePath = process.env.YAADE_MOCK_GOPLS_TRACE
let buffered = Buffer.alloc(0)
const record = value => {
  if (!tracePath) return
  fs.appendFileSync(tracePath, JSON.stringify(value) + "\\n")
}
record({ kind: "boot", argv: process.argv, pid: process.pid })
const send = value => {
  const json = JSON.stringify(value)
  process.stdout.write("Content-Length: " + Buffer.byteLength(json) + "\\r\\n\\r\\n" + json)
}
const handle = message => {
  record({ kind: "recv", method: message.method, id: message.id })
  if (message.method === "initialize") {
    record({ kind: "initialize", rootUri: message.params.rootUri, workspaceFolders: message.params.workspaceFolders })
    send({ jsonrpc: "2.0", id: message.id, result: { capabilities: {
      textDocumentSync: { openClose: true, change: 2, save: {} },
      completionProvider: { triggerCharacters: ["."] },
      hoverProvider: true,
      definitionProvider: true
    } } })
    return
  }
  if (message.method === "initialized") {
    send({ jsonrpc: "2.0", id: 1001, method: "window/workDoneProgress/create", params: { token: "setup" } })
    send({ jsonrpc: "2.0", id: 1002, method: "workspace/configuration", params: {
      items: [{ scopeUri: null, section: "gopls" }]
    } })
    return
  }
  if (message.method === "textDocument/didOpen") {
    record({ kind: "didOpen", document: message.params.textDocument })
    send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: {
      uri: message.params.textDocument.uri,
      version: message.params.textDocument.version,
      diagnostics: []
    } })
    return
  }
  if (message.method === "shutdown") {
    send({ jsonrpc: "2.0", id: message.id, result: null })
    return
  }
  if (message.method === "exit") process.exit(0)
  if (message.id === 1001 || message.id === 1002) {
    record({ kind: "response", id: message.id, result: message.result, error: message.error })
  }
}
process.stdin.on("data", chunk => {
  buffered = Buffer.concat([buffered, chunk])
  for (;;) {
    const headerEnd = buffered.indexOf("\\r\\n\\r\\n")
    if (headerEnd < 0) return
    const header = buffered.subarray(0, headerEnd).toString("ascii")
    const match = /Content-Length:\\s*(\\d+)/i.exec(header)
    if (!match) { buffered = buffered.subarray(headerEnd + 4); continue }
    const length = Number(match[1])
    const start = headerEnd + 4
    if (buffered.length < start + length) return
    const body = buffered.subarray(start, start + length).toString("utf8")
    buffered = buffered.subarray(start + length)
    handle(JSON.parse(body))
  }
})
`
  writeFileSync(executable, script)
  if (process.platform !== "win32") chmodSync(executable, 0o755)
  return {
    binDir,
    tracePath,
    remove: () => rmSync(dir, { recursive: true, force: true }),
  }
}

test.describe("Go language server", () => {
  test.skip(!ptyAvailable || process.platform === "win32", "PTY and executable script support required")

  test("loads the Go workspace and answers gopls client requests", async () => {
    const mock = createMockGopls()
    const { app, page } = await launchJet({
      env: {
        PATH: `${mock.binDir}${delimiter}${process.env.PATH ?? ""}`,
        YAADE_LSP_GOPLS_BIN: join(
          mock.binDir,
          process.platform === "win32" ? "gopls.cmd" : "gopls",
        ),
        YAADE_MOCK_GOPLS_TRACE: mock.tracePath,
      },
    })
    try {
      await execCommand(page, "terminal.new")
      await expectSelectorVisible(page, "[data-yaade-terminal-modal]", { timeout: 20_000 })
      await page.locator('[data-yaade-session-mode-tab="editor"]').click()
      await page.evaluate(async () => {
        await window.__yaadeAgent!.openFile("src/example.go")
        await window.__yaadeAgent!.waitForEditor()
      })

      await expect
        .poll(
          () =>
            page
              .locator("[data-yaade-editor-lsp]")
              .first()
              .getAttribute("data-yaade-editor-lsp"),
          { timeout: 20_000 },
        )
        .toBe("ready")

      await expect
        .poll(() => {
          try {
            return readFileSync(mock.tracePath, "utf8")
          } catch {
            return ""
          }
        }, { timeout: 10_000 })
        .toContain('"kind":"didOpen"')

      await expect
        .poll(() => {
          try {
            return readFileSync(mock.tracePath, "utf8")
          } catch {
            return ""
          }
        }, { timeout: 10_000 })
        .toContain('"id":1002')

      const events = readFileSync(mock.tracePath, "utf8")
        .trim()
        .split("\n")
        .map(line => JSON.parse(line) as {
          kind: string
          id?: string
          result?: unknown
          rootUri?: string
          document?: { languageId?: string; uri?: string }
        })
      const initialized = events.find(event => event.kind === "initialize")
      const opened = events.find(event => event.kind === "didOpen")
      const configuration = events.find(event => event.kind === "response" && event.id === 1002)
      const progress = events.find(event => event.kind === "response" && event.id === 1001)

      expect(initialized?.rootUri).toMatch(/sample-workspace$/)
      expect(opened?.document?.languageId).toBe("go")
      expect(opened?.document?.uri).toMatch(/src\/example\.go$/)
      expect(configuration?.result).toEqual([{}])
      expect(progress?.result).toBeNull()
    } finally {
      await app.close()
      mock.remove()
    }
  })
})
