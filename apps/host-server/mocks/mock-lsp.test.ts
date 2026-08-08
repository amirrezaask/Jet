import assert from "node:assert/strict";
import {
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { afterEach, describe, it } from "node:test";
import {
  createMockLspHarness,
  mockLspMessageField,
  mockLspMessageMethod,
  type MockLspHarness,
} from "./mock-lsp-harness.js";

type RunningMock = {
  proc: ChildProcessWithoutNullStreams;
  stderr: () => string;
};

const running = new Set<ChildProcess>();
const harnesses = new Set<MockLspHarness>();

function field(value: unknown, key: string): unknown {
  return mockLspMessageField(value, key);
}

function stringField(value: unknown, key: string): string | undefined {
  const result = field(value, key);
  return typeof result === "string" ? result : undefined;
}

function arrayField(value: unknown, key: string): readonly unknown[] {
  const result = field(value, key);
  return Array.isArray(result) ? result : [];
}

function launchMock(harness: MockLspHarness): RunningMock {
  const proc = spawn(harness.binaryPath, ["--stdio"], {
    env: { ...process.env, ...harness.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (!proc.stdin || !proc.stdout || !proc.stderr) {
    proc.kill("SIGKILL");
    throw new Error("mock LSP did not expose stdio pipes");
  }
  running.add(proc);
  let stderr = "";
  proc.stderr.on("data", (chunk) => {
    stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  });
  proc.stdout.resume();
  proc.once("exit", () => running.delete(proc));
  return { proc, stderr: () => stderr };
}

function send(
  proc: ChildProcessWithoutNullStreams,
  message: unknown,
  fragmented = false,
): void {
  const json = JSON.stringify(message);
  const frame = Buffer.from(
    `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`,
    "utf8",
  );
  if (!fragmented) {
    proc.stdin.write(frame);
    return;
  }
  const split = Math.floor(frame.length / 2);
  proc.stdin.write(frame.subarray(0, split));
  proc.stdin.write(frame.subarray(split));
}

async function waitForExit(
  proc: ChildProcess,
  timeoutMs = 5_000,
): Promise<number | null> {
  if (proc.exitCode !== null) return proc.exitCode;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new Error(`timed out after ${timeoutMs}ms waiting for mock LSP exit`),
      );
    }, timeoutMs);
    proc.once("exit", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}

afterEach(async () => {
  const exits: Promise<number | null>[] = [];
  for (const proc of running) {
    exits.push(waitForExit(proc, 1_000).catch(() => null));
    proc.kill("SIGKILL");
  }
  await Promise.all(exits);
  running.clear();
  for (const harness of harnesses) harness.dispose();
  harnesses.clear();
});

describe("yaade-mock-lsp", () => {
  it(
    "exposes deterministic editor/navigation features and lifecycle controls",
    { timeout: 20_000 },
    async () => {
      const harness = createMockLspHarness();
      harnesses.add(harness);
      const first = launchMock(harness);
      await harness.waitForStartCount(1);

      let nextId = 1;
      const request = async (
        method: string,
        params: unknown,
      ): Promise<unknown> => {
        const id = nextId;
        nextId += 1;
        send(first.proc, { jsonrpc: "2.0", id, method, params });
        const response = await harness.waitForResponse(id);
        assert.equal(field(response.message, "error"), undefined);
        return field(response.message, "result");
      };

      const uri = "file:///workspace/src/mock.ts";
      const initialize = await (async () => {
        const id = nextId;
        nextId += 1;
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
        );
        return field((await harness.waitForResponse(id)).message, "result");
      })();
      const capabilities = field(initialize, "capabilities");
      assert.equal(
        field(field(capabilities, "completionProvider"), "resolveProvider"),
        true,
      );
      assert.equal(field(capabilities, "definitionProvider"), true);
      assert.equal(field(capabilities, "referencesProvider"), true);
      assert.equal(field(capabilities, "callHierarchyProvider"), true);
      assert.equal(field(capabilities, "typeHierarchyProvider"), true);
      assert.equal(
        field(field(capabilities, "codeActionProvider"), "resolveProvider"),
        true,
      );
      assert.equal(
        stringField(
          field(capabilities, "documentOnTypeFormattingProvider"),
          "firstTriggerCharacter",
        ),
        "}",
      );
      assert.deepEqual(
        field(field(capabilities, "semanticTokensProvider"), "full"),
        {
          delta: true,
        },
      );
      assert.equal(
        field(field(capabilities, "semanticTokensProvider"), "range"),
        true,
      );
      assert.equal(field(capabilities, "foldingRangeProvider"), true);
      assert.equal(field(capabilities, "selectionRangeProvider"), true);
      assert.equal(
        field(field(capabilities, "documentLinkProvider"), "resolveProvider"),
        true,
      );
      assert.equal(field(capabilities, "colorProvider"), true);
      assert.equal(field(capabilities, "workspaceSymbolProvider"), true);
      assert.deepEqual(field(field(capabilities, "textDocumentSync"), "save"), {
        includeText: true,
      });
      assert.equal(
        field(field(capabilities, "textDocumentSync"), "willSave"),
        true,
      );
      assert.equal(
        field(field(capabilities, "textDocumentSync"), "willSaveWaitUntil"),
        true,
      );

      send(first.proc, { jsonrpc: "2.0", method: "initialized", params: {} });
      const registration = await harness.waitForServerMethod(
        "client/registerCapability",
      );
      const registrationId = field(registration.message, "id");
      assert.equal(typeof registrationId, "string");
      const registeredMethods = arrayField(
        field(registration.message, "params"),
        "registrations",
      ).map((item) => stringField(item, "method"));
      assert.deepEqual(registeredMethods, [
        "textDocument/didSave",
        "workspace/didChangeWatchedFiles",
      ]);
      send(first.proc, { jsonrpc: "2.0", id: registrationId, result: null });
      await harness.waitForCapture(
        (capture) =>
          capture.direction === "client" &&
          field(capture.message, "id") === registrationId &&
          mockLspMessageMethod(capture.message) === undefined,
      );

      const readyMessage =
        await harness.waitForServerMethod("window/showMessage");
      assert.match(
        stringField(field(readyMessage.message, "params"), "message") ?? "",
        /Mock language server initialized/,
      );

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
      });
      const diagnostics = await harness.waitForServerMethod(
        "textDocument/publishDiagnostics",
      );
      assert.equal(
        stringField(
          arrayField(field(diagnostics.message, "params"), "diagnostics")[0],
          "code",
        ),
        "mock-warning",
      );

      const completion = await request("textDocument/completion", {
        textDocument: { uri },
        position: { line: 0, character: 4 },
      });
      const completionItem = arrayField(completion, "items")[0];
      assert.equal(stringField(completionItem, "label"), "mockCompletion");

      const resolvedCompletion = await request(
        "completionItem/resolve",
        completionItem,
      );
      assert.equal(
        stringField(resolvedCompletion, "detail"),
        "Resolved mock completion",
      );
      assert.match(
        stringField(field(resolvedCompletion, "documentation"), "value") ?? "",
        /yaade-mock-lsp/,
      );

      const definition = await request("textDocument/definition", {
        textDocument: { uri },
        position: { line: 0, character: 1 },
      });
      assert.equal(
        stringField(Array.isArray(definition) ? definition[0] : null, "uri"),
        uri,
      );

      const references = await request("textDocument/references", {
        textDocument: { uri },
        position: { line: 0, character: 1 },
        context: { includeDeclaration: true },
      });
      assert.equal(Array.isArray(references) ? references.length : 0, 2);

      const preparedRename = await request("textDocument/prepareRename", {
        textDocument: { uri },
        position: { line: 0, character: 1 },
      });
      assert.equal(stringField(preparedRename, "placeholder"), "mock");
      const rename = await request("textDocument/rename", {
        textDocument: { uri },
        position: { line: 0, character: 1 },
        newName: "renamedMock",
      });
      const renameChanges = field(rename, "changes");
      assert.equal(
        Array.isArray(field(renameChanges, uri))
          ? arrayField(renameChanges, uri).length
          : 0,
        2,
      );

      const formatting = await request("textDocument/formatting", {
        textDocument: { uri },
        options: { tabSize: 2, insertSpaces: true },
      });
      assert.equal(
        stringField(
          Array.isArray(formatting) ? formatting[0] : null,
          "newText",
        ),
        "mock\nconst value = 1\nmock\n",
      );

      const saveEdits = await request("textDocument/willSaveWaitUntil", {
        textDocument: { uri },
        reason: 1,
      });
      assert.deepEqual(saveEdits, []);

      const symbols = await request("textDocument/documentSymbol", {
        textDocument: { uri },
      });
      const symbol = Array.isArray(symbols) ? symbols[0] : null;
      assert.equal(stringField(symbol, "name"), "MockSymbol");
      assert.equal(
        stringField(arrayField(symbol, "children")[0], "name"),
        "mockValue",
      );

      const codeActions = await request("textDocument/codeAction", {
        textDocument: { uri },
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 4 },
        },
        context: { diagnostics: [] },
      });
      const codeAction = Array.isArray(codeActions) ? codeActions[0] : null;
      assert.equal(field(codeAction, "edit"), undefined);
      const resolvedCodeAction = await request(
        "codeAction/resolve",
        codeAction,
      );
      assert.equal(
        stringField(field(resolvedCodeAction, "command"), "command"),
        "yaade.mock.echo",
      );
      assert.equal(
        stringField(
          arrayField(
            field(field(resolvedCodeAction, "edit"), "changes"),
            uri,
          )[0],
          "newText",
        ),
        "fixed",
      );

      const onTypeEdits = await request("textDocument/onTypeFormatting", {
        textDocument: { uri },
        position: { line: 1, character: 9 },
        ch: "}",
        options: { tabSize: 2, insertSpaces: true },
      });
      assert.equal(
        stringField(
          Array.isArray(onTypeEdits) ? onTypeEdits[0] : null,
          "newText",
        ),
        " // mock on-type",
      );

      const semanticFull = await request("textDocument/semanticTokens/full", {
        textDocument: { uri },
      });
      assert.equal(stringField(semanticFull, "resultId"), "mock-semantic-1");
      const semanticDelta = await request(
        "textDocument/semanticTokens/full/delta",
        {
          textDocument: { uri },
          previousResultId: "mock-semantic-1",
        },
      );
      assert.equal(stringField(semanticDelta, "resultId"), "mock-semantic-2");
      assert.equal(arrayField(semanticDelta, "edits").length, 1);
      const semanticRange = await request("textDocument/semanticTokens/range", {
        textDocument: { uri },
        range: {
          start: { line: 0, character: 0 },
          end: { line: 1, character: 9 },
        },
      });
      assert.deepEqual(arrayField(semanticRange, "data"), [0, 0, 4, 0, 1]);

      const foldingRanges = await request("textDocument/foldingRange", {
        textDocument: { uri },
      });
      assert.equal(
        stringField(
          Array.isArray(foldingRanges) ? foldingRanges[0] : null,
          "kind",
        ),
        "region",
      );
      const selectionRanges = await request("textDocument/selectionRange", {
        textDocument: { uri },
        positions: [{ line: 1, character: 2 }],
      });
      assert.equal(
        field(
          Array.isArray(selectionRanges) ? selectionRanges[0] : null,
          "parent",
        ) != null,
        true,
      );

      const documentLinks = await request("textDocument/documentLink", {
        textDocument: { uri },
      });
      const documentLink = Array.isArray(documentLinks)
        ? documentLinks[0]
        : null;
      assert.equal(field(documentLink, "target"), undefined);
      const resolvedDocumentLink = await request(
        "documentLink/resolve",
        documentLink,
      );
      assert.equal(
        stringField(resolvedDocumentLink, "target"),
        "https://example.test/yaade-mock-lsp",
      );

      const documentColors = await request("textDocument/documentColor", {
        textDocument: { uri },
      });
      const documentColor = Array.isArray(documentColors)
        ? documentColors[0]
        : null;
      assert.equal(field(field(documentColor, "color"), "blue"), 0.75);
      const colorPresentations = await request(
        "textDocument/colorPresentation",
        {
          textDocument: { uri },
          color: field(documentColor, "color"),
          range: field(documentColor, "range"),
        },
      );
      assert.equal(
        stringField(
          Array.isArray(colorPresentations) ? colorPresentations[0] : null,
          "label",
        ),
        "rgba(64, 128, 191, 1)",
      );

      const workspaceSymbols = await request("workspace/symbol", {
        query: "Mock",
      });
      assert.equal(
        stringField(
          Array.isArray(workspaceSymbols) ? workspaceSymbols[0] : null,
          "name",
        ),
        "MockWorkspaceSymbol",
      );

      const callItems = await request("textDocument/prepareCallHierarchy", {
        textDocument: { uri },
        position: { line: 0, character: 1 },
      });
      const callItem = Array.isArray(callItems) ? callItems[0] : null;
      assert.equal(stringField(callItem, "name"), "MockSymbol");
      const callers = await request("callHierarchy/incomingCalls", {
        item: callItem,
      });
      assert.equal(
        stringField(
          field(Array.isArray(callers) ? callers[0] : null, "from"),
          "name",
        ),
        "MockCaller",
      );

      const typeItems = await request("textDocument/prepareTypeHierarchy", {
        textDocument: { uri },
        position: { line: 0, character: 1 },
      });
      const typeItem = Array.isArray(typeItems) ? typeItems[0] : null;
      const subtypes = await request("typeHierarchy/subtypes", {
        item: typeItem,
      });
      assert.equal(
        stringField(Array.isArray(subtypes) ? subtypes[0] : null, "name"),
        "MockDerived",
      );

      const beforeSave = harness.captures().length;
      send(first.proc, {
        jsonrpc: "2.0",
        method: "textDocument/didSave",
        params: { textDocument: { uri }, text: "mock saved\n" },
      });
      await harness.waitForClientMethod("textDocument/didSave", {
        afterCaptureCount: beforeSave,
      });
      const saveMessage = await harness.waitForCapture(
        (capture) =>
          capture.direction === "server" &&
          mockLspMessageMethod(capture.message) === "window/showMessage" &&
          (
            stringField(field(capture.message, "params"), "message") ?? ""
          ).includes("Mock observed save"),
        { afterCaptureCount: beforeSave },
      );
      assert.equal(saveMessage.direction, "server");

      const beforeControlledMessage = harness.captures().length;
      harness.showMessage("Controlled server-message capture", {
        generation: 1,
        type: 2,
      });
      const controlledMessage = await harness.waitForCapture(
        (capture) =>
          capture.direction === "server" &&
          mockLspMessageMethod(capture.message) === "window/showMessage" &&
          stringField(field(capture.message, "params"), "message") ===
            "Controlled server-message capture",
        { afterCaptureCount: beforeControlledMessage },
      );
      assert.equal(controlledMessage.direction, "server");

      const beforeInteractions = harness.captures().length;
      harness.showMessageRequest("Choose from the mock actions", {
        generation: 1,
      });
      const messageRequest = await harness.waitForServerMethod(
        "window/showMessageRequest",
        {
          afterCaptureCount: beforeInteractions,
        },
      );
      assert.equal(
        stringField(field(messageRequest.message, "params"), "message"),
        "Choose from the mock actions",
      );
      send(first.proc, {
        jsonrpc: "2.0",
        id: field(messageRequest.message, "id"),
        result: { title: "Accept" },
      });

      harness.showDocument(uri, { generation: 1 });
      const showDocument = await harness.waitForServerMethod(
        "window/showDocument",
        {
          afterCaptureCount: beforeInteractions,
        },
      );
      assert.equal(
        stringField(field(showDocument.message, "params"), "uri"),
        uri,
      );
      send(first.proc, {
        jsonrpc: "2.0",
        id: field(showDocument.message, "id"),
        result: { success: true },
      });

      harness.workDoneProgress("Indexing mock workspace", { generation: 1 });
      const progressCreate = await harness.waitForServerMethod(
        "window/workDoneProgress/create",
        {
          afterCaptureCount: beforeInteractions,
        },
      );
      send(first.proc, {
        jsonrpc: "2.0",
        id: field(progressCreate.message, "id"),
        result: null,
      });
      const progress = await harness.waitForServerMethod("$/progress", {
        afterCaptureCount: beforeInteractions,
      });
      assert.equal(
        stringField(
          field(field(progress.message, "params"), "value"),
          "message",
        ),
        "Indexing mock workspace",
      );
      const progressToken = field(field(progress.message, "params"), "token");
      const beforeProgressCancel = harness.captures().length;
      send(first.proc, {
        jsonrpc: "2.0",
        method: "window/workDoneProgress/cancel",
        params: { token: progressToken },
      });
      const progressEnd = await harness.waitForCapture(
        (capture) =>
          capture.direction === "server" &&
          mockLspMessageMethod(capture.message) === "$/progress" &&
          stringField(
            field(field(capture.message, "params"), "value"),
            "kind",
          ) === "end",
        { afterCaptureCount: beforeProgressCancel },
      );
      assert.equal(progressEnd.direction, "server");
      assert.equal(
        stringField(
          field(field(progressEnd.message, "params"), "value"),
          "message",
        ),
        "Mock work cancelled",
      );
      await harness.waitForCapture(
        (capture) =>
          capture.direction === "event" && capture.event === "progress-cancel",
        { afterCaptureCount: beforeProgressCancel },
      );

      harness.restart(1);
      assert.equal(await waitForExit(first.proc), 86, first.stderr());

      const second = launchMock(harness);
      await harness.waitForStartCount(2);
      harness.crash(2);
      assert.equal(await waitForExit(second.proc), 1, second.stderr());

      assert.equal(harness.events("restart").length, 1);
      assert.equal(harness.events("crash").length, 1);
      assert.equal(harness.startCount(), 2);
    },
  );
});
