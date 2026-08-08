import assert from "node:assert/strict"
import { test } from "node:test"
import { createYaadeApi } from "./create-yaade-api.js"
import type { YaadeHostTransport } from "./transport.js"

test("search requests propagate the caller AbortSignal through the transport", async () => {
  let observed: { channel: string; args: unknown[]; signal: AbortSignal } | undefined
  const transport: YaadeHostTransport = {
    invoke: async () => {
      throw new Error("uncancellable invoke should not be used")
    },
    invokeWithSignal: (channel, args, signal) => {
      observed = { channel, args, signal }
      return new Promise((_resolve, reject) => {
        const abort = () => reject(signal.reason)
        signal.addEventListener("abort", abort, { once: true })
      })
    },
    on: () => () => {},
  }
  const api = createYaadeApi(transport)
  const controller = new AbortController()
  const pending = api.search.project(
    "file:///workspace",
    "needle",
    { wholeWord: true, include: ["src/**"] },
    controller.signal,
  )

  controller.abort()
  await assert.rejects(pending, error => error instanceof Error && error.name === "AbortError")
  assert.equal(observed?.channel, "search:project")
  assert.deepEqual(observed?.args, [
    "file:///workspace",
    "needle",
    { wholeWord: true, include: ["src/**"] },
  ])
  assert.equal(observed?.signal, controller.signal)
})
