import assert from "node:assert/strict"
import { test } from "node:test"
import { AcpClient } from "./client.js"

test("AcpClient constructs with defaults", () => {
  const client = new AcpClient({ command: "false", args: [] })
  assert.ok(client)
})
