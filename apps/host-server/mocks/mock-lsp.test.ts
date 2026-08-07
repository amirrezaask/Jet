import assert from "node:assert/strict"
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process"
import { afterEach, describe, it } from "node:test"
import {
  createMockLspHarness,
  mockLspMessageField,
  mockLspMessageMethod,
  type MockLspHarness,
} from "./mock-lsp-harness.js"

type RunningMock = {
  proc: ChildProcessWithoutNullStreams
  stderr: () => string
}

const running = new Set<ChildProcess>()
const harnesses = new Set<MockLspHarness>()

function field(value: unknown, key: string): unknown {
  return mockLspMessageField(value, key)
}

function stringField(value: unknown, key: string): string | undefined {
  const result = field(value, key)
  return typeof result === "string" ? result : undefined
}

function arrayField(value: unknown, key: string): readonly unknown[] {
  const result = field(value, key)
  return Array.isArray(result) ? result : []
}

function launchMock(harness: MockLspHarness): RunningMock {
  const proc = spawn(harness.binaryPath, ["--stdio"], {
    env: { ...process.env, ...harness.env },
    stdio: ["pipe", "pipe", "pipe"],
  })
  if (!proc.stdin || !proc.stdout || !proc.stderr) {
    proc.kill("SIGKILL")
    throw new Error("mock LSP did not expose stdio pipes")
  }
  running.add(proc)
  let stderr = ""
  proc.stderr.on("data", chunk => {
    stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk)
  })
  proc.stdout.resume()
  proc.once("exit", () => running.delete(proc))
  return { proc, stderr: () => stderr }
}

function send(proc: ChildProcessWithoutNullStreams, message: unknown, fragmented = false): void {
  const json = JSON.stringify(message)
  const frame = Buffer.from(
    `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`,
    "utf8",
  )
  if (!fragmented) {
    proc.stdin.write(frame)
    return
  }
  const split = Math.floor(frame.length / 2)
  proc.stdin.write(frame.subarray(0, split))
  proc.stdin.write(frame.subarray(split))
}

async function waitForExit(proc: ChildProcess, timeoutMs = 5_000): Promise<number | null> {
  if (proc.exitCode !== null) return proc.exitCode
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`timed out after ${timeoutMs}ms waiting for mock LSP exit`))
    }, timeoutMs)
    proc.once("exit", code => {
      clearTimeout(timeout)
      resolve(code)
    })
  })
}

afterEach(async () => {
  const exits: Promise<number | null>[] = []
  for (const proc of running) {
    exits.push(waitForExit(proc, 1_000).catch(() => null))
    proc.kill("SIGKILL")
  }
  await Promise.all(exits)
  running.clear()
  for (const harness of harnesses) harness.dispose()
  harnesses.clear()
})

describe("yaade-mock-lsp", () => {
  it("exposes deterministic editor/navigation features and lifecycle controls", { timeout: 20_000 }, async () => {
    const harness = createMockLspHarness()
    harnesses.add(harness)
    const first = launchMock(harness)
    await harness.waitForStartCount(1)

    let nextId = 1
    const request = async (method: string, params: unknown): Promise<unknown> => {
      const id = nextId
      nextId += 1
      send(first.proc, { jsonrpc: "2.0", id, method, params })
      const response = await harness.waitForResponse(id)
      assert.equal(field(response.message, "error"), undefined)
      return field(response.message, "result")
    }

    const uri = "file:///workspace/src/mock.ts"
    const initialize = await (async () => {
      const id = nextId
      nextId += 1
      send(
        first.proc,
        {
          jsonrpc: "2.0",
          id,
          method: "initialize",
          params: {
            processId: null,
            rootUri: "file:///workspace",
            capabilities: {},
          },
        },
        true,
      )
      return field((await harness.waitForResponse(id)).message, "result")
    })()
    const capabilities = field(initialize, "capabilities")
    assert.equal(field(field(capabilities, "completionProvider"), "resolveProvider"), true)
    assert.equal(field(capabilities, "definitionProvider"), true)
    assert.equal(field(capabilities, "referencesProvider"), true)
    assert.equal(field(capabilities, "callHierarchyProvider"), true)
    assert.equal(field(capabilities, "typeHierarchyProvider"), true)
    assert.deepEqual(field(field(capabilities, "textDocumentSync"), "save"), { includeText: true })

    send(first.proc, { jsonrpc: "2.0", method: "initialized", params: {} })
    const registration = await harness.waitForServerMethod("client/registerCapability")
    const registrationId = field(registration.message, "id")
    assert.equal(typeof registrationId, "string")
    assert.equal(
      stringField(arrayField(field(registration.message, "params"), "registrations")[0], "method"),
      "textDocument/didSave",
    )
    send(first.proc, { jsonrpc: "2.0", id: registrationId, result: null })
    await harness.waitForCapture(
      capture =>
        capture.direction === "client" &&
        field(capture.message, "id") === registrationId &&
        mockLspMessageMethod(capture.message) === undefined,
    )

    const readyMessage = await harness.waitForServerMethod("window/showMessage")
    assert.match(
      stringField(field(readyMessage.message, "params"), "message") ?? "",
      /Mock language server initialized/,
    )

    send(first.proc, {
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri,
          languageId: "typescript",
          version: 1,
          text: "mock   \nconst value = 1\nmock\n",
        },
      },
    })
    const diagnostics = await harness.waitForServerMethod("textDocument/publishDiagnostics")
    assert.equal(
      stringField(arrayField(field(diagnostics.message, "params"), "diagnostics")[0], "code"),
      "mock-warning",
    )

    const completion = await request("textDocument/completion", {
      textDocument: { uri },
      position: { line: 0, character: 4 },
    })
    const completionItem = arrayField(completion, "items")[0]
    assert.equal(stringField(completionItem, "label"), "mockCompletion")

    const resolvedCompletion = await request("completionItem/resolve", completionItem)
    assert.equal(stringField(resolvedCompletion, "detail"), "Resolved mock completion")
    assert.match(
      stringField(field(resolvedCompletion, "documentation"), "value") ?? "",
      /yaade-mock-lsp/,
    )

    const definition = await request("textDocument/definition", {
      textDocument: { uri },
      position: { line: 0, character: 1 },
    })
    assert.equal(stringField(Array.isArray(definition) ? definition[0] : null, "uri"), uri)

    const references = await request("textDocument/references", {
      textDocument: { uri },
      position: { line: 0, character: 1 },
      context: { includeDeclaration: true },
    })
    assert.equal(Array.isArray(references) ? references.length : 0, 2)

    const preparedRename = await request("textDocument/prepareRename", {
      textDocument: { uri },
      position: { line: 0, character: 1 },
    })
    assert.equal(stringField(preparedRename, "placeholder"), "mock")
    const rename = await request("textDocument/rename", {
      textDocument: { uri },
      position: { line: 0, character: 1 },
      newName: "renamedMock",
    })
    const renameChanges = field(rename, "changes")
    assert.equal(Array.isArray(field(renameChanges, uri)) ? arrayField(renameChanges, uri).length : 0, 2)

    const formatting = await request("textDocument/formatting", {
      textDocument: { uri },
      options: { tabSize: 2, insertSpaces: true },
    })
    assert.equal(stringField(Array.isArray(formatting) ? formatting[0] : null, "newText"), "mock\nconst value = 1\nmock\n")

    const symbols = await request("textDocument/documentSymbol", { textDocument: { uri } })
    const symbol = Array.isArray(symbols) ? symbols[0] : null
    assert.equal(stringField(symbol, "name"), "MockSymbol")
    assert.equal(stringField(arrayField(symbol, "children")[0], "name"), "mockValue")

    const callItems = await request("textDocument/prepareCallHierarchy", {
      textDocument: { uri },
      position: { line: 0, character: 1 },
    })
    const callItem = Array.isArray(callItems) ? callItems[0] : null
    assert.equal(stringField(callItem, "name"), "MockSymbol")
    const callers = await request("callHierarchy/incomingCalls", { item: callItem })
    assert.equal(stringField(field(Array.isArray(callers) ? callers[0] : null, "from"), "name"), "MockCaller")

    const typeItems = await request("textDocument/prepareTypeHierarchy", {
      textDocument: { uri },
      position: { line: 0, character: 1 },
    })
    const typeItem = Array.isArray(typeItems) ? typeItems[0] : null
    const subtypes = await request("typeHierarchy/subtypes", { item: typeItem })
    assert.equal(stringField(Array.isArray(subtypes) ? subtypes[0] : null, "name"), "MockDerived")

    const beforeSave = harness.captures().length
    send(first.proc, {
      jsonrpc: "2.0",
      method: "textDocument/didSave",
      params: { textDocument: { uri }, text: "mock saved\n" },
    })
    await harness.waitForClientMethod("textDocument/didSave", { afterCaptureCount: beforeSave })
    const saveMessage = await harness.waitForCapture(
      capture =>
        capture.direction === "server" &&
        mockLspMessageMethod(capture.message) === "window/showMessage" &&
        (stringField(field(capture.message, "params"), "message") ?? "").includes("Mock observed save"),
      { afterCaptureCount: beforeSave },
    )
    assert.equal(saveMessage.direction, "server")

    const beforeControlledMessage = harness.captures().length
    harness.showMessage("Controlled server-message capture", { generation: 1, type: 2 })
    const controlledMessage = await harness.waitForCapture(
      capture =>
        capture.direction === "server" &&
        mockLspMessageMethod(capture.message) === "window/showMessage" &&
        stringField(field(capture.message, "params"), "message") === "Controlled server-message capture",
      { afterCaptureCount: beforeControlledMessage },
    )
    assert.equal(controlledMessage.direction, "server")

    harness.restart(1)
    assert.equal(await waitForExit(first.proc), 86, first.stderr())

    const second = launchMock(harness)
    await harness.waitForStartCount(2)
    harness.crash(2)
    assert.equal(await waitForExit(second.proc), 1, second.stderr())

    assert.equal(harness.events("restart").length, 1)
    assert.equal(harness.events("crash").length, 1)
    assert.equal(harness.startCount(), 2)
  })
})
