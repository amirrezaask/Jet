import assert from "node:assert/strict"
import { test } from "node:test"

import { createYaadeApi } from "./create-yaade-api.js"
import type { YaadeHostTransport } from "./transport.js"

test("sends the mux session identity with workspace lease requests", async () => {
  const calls: Array<{ channel: string; args: unknown[] }> = []
  const transport: YaadeHostTransport = {
    invoke: async (channel, ...args) => {
      calls.push({ channel, args })
      return { ok: true } as never
    },
    on: () => () => {},
  }
  const api = createYaadeApi(transport)
  const workspace = api.workspace
  assert.ok(workspace)
  const rootUri = "file:///workspace"

  await workspace.activate(rootUri, { sessionId: "session-one" })
  await workspace.activate(rootUri, { sessionId: "session-two" })
  await workspace.deactivate?.(rootUri, { sessionId: "session-one" })

  assert.deepEqual(calls, [
    {
      channel: "workspace:activate",
      args: [rootUri, "session-one"],
    },
    {
      channel: "workspace:activate",
      args: [rootUri, "session-two"],
    },
    {
      channel: "workspace:deactivate",
      args: [rootUri, "session-one"],
    },
  ])
})
