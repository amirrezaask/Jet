import assert from "node:assert/strict"
import test from "node:test"
import { acceptHostEvent, websocketUrl } from "./web-transport.js"

test("websocket URL follows the page origin and carries replay sequence", () => {
  assert.equal(websocketUrl({ protocol: "http:", host: "example.test:4747" } as Location, 42), "ws://example.test:4747/ws?since=42")
  assert.equal(websocketUrl({ protocol: "https:", host: "jet.example" } as Location), "wss://jet.example/ws?since=0")
})

test("protocol gate rejects duplicates and incompatible messages", () => {
  assert.equal(acceptHostEvent(4, { protocolVersion: 1, sequence: 5, channel: "x", args: [] }), true)
  assert.equal(acceptHostEvent(5, { protocolVersion: 1, sequence: 5, channel: "x", args: [] }), false)
  assert.equal(acceptHostEvent(0, { protocolVersion: 2, sequence: 1, channel: "x", args: [] }), false)
})
