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

function createMockTypescriptLanguageServer(): {
  binDir: string
  tracePath: string
  remove(): void
} {
  const dir = mkdtempSync(join(tmpdir(), "gharargah-tsls-"))
  const binDir = join(dir, "bin")
  const tracePath = join(dir, "trace.jsonl")
  mkdirSync(binDir)
  const executable = join(
    binDir,
    process.platform === "win32" ? "typescript-language-server.cmd" : "typescript-language-server",
  )
  const script = `#!/usr/bin/env node
const fs = require("node:fs")
const path = require("node:path")
const tracePath = process.env.GHARARGAH_MOCK_TSLS_TRACE
let buffered = Buffer.alloc(0)
let rootUri = ""
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
    rootUri = message.params.rootUri || ""
    record({
      kind: "initialize",
      rootUri: message.params.rootUri,
      workspaceFolders: message.params.workspaceFolders,
    })
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        capabilities: {
          textDocumentSync: { openClose: true, change: 2, save: {} },
          completionProvider: { triggerCharacters: ["."] },
          hoverProvider: true,
          definitionProvider: true,
        },
      },
    })
    return
  }
  if (message.method === "initialized") {
    send({
      jsonrpc: "2.0",
      id: 1001,
      method: "workspace/configuration",
      params: {
        items: [{ scopeUri: null, section: "typescript" }],
      },
    })
    return
  }
  if (message.method === "textDocument/didOpen") {
    record({ kind: "didOpen", document: message.params.textDocument })
    send({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri: message.params.textDocument.uri,
        version: message.params.textDocument.version,
        diagnostics: [],
      },
    })
    return
  }
  if (message.method === "textDocument/definition") {
    const target = rootUri.replace(/\\/$/, "") + "/src/utils.ts"
    record({ kind: "definition", params: message.params, target })
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        uri: target,
        range: {
          start: { line: 0, character: 16 },
          end: { line: 0, character: 21 },
        },
      },
    })
    return
  }
  if (message.method === "shutdown") {
    send({ jsonrpc: "2.0", id: message.id, result: null })
    return
  }
  if (message.method === "exit") process.exit(0)
  if (message.id === 1001) {
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
    if (!match) {
      buffered = buffered.subarray(headerEnd + 4)
      continue
    }
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

test.describe("TypeScript language server", () => {
  test.skip(!ptyAvailable || process.platform === "win32", "PTY and executable script support required")

  test("loads the TypeScript workspace and answers client requests", async () => {
    const mock = createMockTypescriptLanguageServer()
    const { app, page } = await launchJet({
      env: {
        PATH: `${mock.binDir}${delimiter}${process.env.PATH ?? ""}`,
        GHARARGAH_LSP_TYPESCRIPT_LANGUAGE_SERVER_BIN: join(
          mock.binDir,
          process.platform === "win32" ? "typescript-language-server.cmd" : "typescript-language-server",
        ),
        GHARARGAH_MOCK_TSLS_TRACE: mock.tracePath,
      },
    })
    try {
      await execCommand(page, "terminal.new")
      await expectSelectorVisible(page, "[data-gharargah-terminal-modal]", { timeout: 20_000 })
      await page.locator('[data-gharargah-session-mode-tab="editor"]').click()
      await page.evaluate(async () => {
        await window.__gharargahAgent!.openFile("src/index.ts")
        await window.__gharargahAgent!.waitForEditor()
      })

      await expect
        .poll(
          () =>
            page
              .locator("[data-gharargah-editor-lsp]")
              .first()
              .getAttribute("data-gharargah-editor-lsp"),
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
        .toContain('"id":1001')

      const events = readFileSync(mock.tracePath, "utf8")
        .trim()
        .split("\n")
        .map(
          line =>
            JSON.parse(line) as {
              kind: string
              id?: string
              result?: unknown
              rootUri?: string
              document?: { languageId?: string; uri?: string }
            },
        )
      const initialized = events.find(event => event.kind === "initialize")
      const opened = events.find(event => event.kind === "didOpen")
      const configuration = events.find(event => event.kind === "response" && event.id === 1001)

      expect(initialized?.rootUri).toMatch(/sample-workspace$/)
      expect(opened?.document?.languageId).toBe("typescript")
      expect(opened?.document?.uri).toMatch(/src\/index\.ts$/)
      expect(configuration?.result).toEqual([{}])

      // Cursor on `greet` import → go to definition must open utils.ts.
      await page.locator(".monaco-editor textarea.inputarea").click({ force: true })
      await page.evaluate(() => {
        window.__gharargahAgent!.setEditorSelection(1, 10)
      })
      await expect
        .poll(() => page.evaluate(() => window.__gharargahAgent!.getCursorPosition()), {
          timeout: 5_000,
        })
        .toEqual({ line: 1, column: 10 })

      await execCommand(page, "editor.action.revealDefinition")

      await expect
        .poll(() => {
          try {
            return readFileSync(mock.tracePath, "utf8")
          } catch {
            return ""
          }
        }, { timeout: 10_000 })
        .toContain('"kind":"definition"')

      await expect
        .poll(async () => page.evaluate(() => window.__gharargahAgent!.getEditorText()), {
          timeout: 10_000,
        })
        .toContain("export function greet")
    } finally {
      await app.close()
      mock.remove()
    }
  })
})
