import assert from "node:assert/strict"
import { test } from "node:test"
import { Effect } from "effect"
import { AcpClient } from "./client.js"
import { acpRequest, closeAcpClient, runAcpRequest } from "./effect.js"

test("acpRequest maps client.request failures to Error", async () => {
  const client = new AcpClient({ command: "false", args: [] })
  await assert.rejects(
    () => Effect.runPromise(acpRequest(client, "initialize", {})),
    (err: unknown) => err instanceof Error && /not started/i.test(err.message),
  )
})

test("runAcpRequest is Promise boundary over acpRequest", async () => {
  const client = new AcpClient({ command: "false", args: [] })
  await assert.rejects(
    () => runAcpRequest(client, "session/close", { sessionId: "x" }),
    (err: unknown) => err instanceof Error,
  )
})

test("closeAcpClient succeeds on never-started client", async () => {
  const client = new AcpClient({ command: "false", args: [] })
  await Effect.runPromise(closeAcpClient(client))
})
