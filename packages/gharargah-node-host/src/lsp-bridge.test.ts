import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { LspFramingDecoder, encodeLspMessage } from "./lsp-bridge.js"

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
})
