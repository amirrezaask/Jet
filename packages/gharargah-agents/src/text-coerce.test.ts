import assert from "node:assert/strict"
import test from "node:test"
import { coerceAssistantText } from "./text-coerce.js"

test("coerceAssistantText flattens Codex content-block arrays", () => {
  assert.equal(
    coerceAssistantText([{ type: "text", text: "hello", text_elements: [] }]),
    "hello",
  )
  assert.equal(coerceAssistantText("plain"), "plain")
  assert.equal(coerceAssistantText(null), "")
})
