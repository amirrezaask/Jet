import assert from "node:assert/strict"
import { test } from "node:test"

import { structuredOutputData } from "./structured-output.js"

test("structured output summarizes document text and large diagnostic payloads", () => {
  assert.deepEqual(structuredOutputData("textDocument/didSave", {
    textDocument: { uri: "file:///workspace/file.ts" },
    text: "large text",
  }), {
    textDocument: { uri: "file:///workspace/file.ts" },
    includeText: true,
    textLength: 10,
  })
  assert.deepEqual(structuredOutputData("textDocument/publishDiagnostics", {
    uri: "file:///workspace/file.ts",
    version: 3,
    diagnostics: [{ message: "one" }, { message: "two" }],
  }), {
    uri: "file:///workspace/file.ts",
    version: 3,
    diagnosticCount: 2,
  })
})
