import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import {
  deleteEditorRecoveryBuffer,
  deleteEditorRecoverySession,
  getEditorRecoveryBuffer,
  listEditorRecoveryBuffers,
  upsertEditorRecoveryBuffer,
} from "./editor-recovery-client.js"

const originalFetch = globalThis.fetch

afterEach(() => {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: originalFetch,
  })
})

function installFetch(
  implementation: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
): void {
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: implementation,
  })
}

test("editor recovery client sends raw text and decodes metadata", async () => {
  const calls: Array<{ url: string; method: string; body: string | null }> = []
  installFetch(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    const method = init?.method ?? "GET"
    const body = typeof init?.body === "string" ? init.body : null
    calls.push({ url, method, body })
    if (method === "PUT") {
      return Response.json({
        sessionId: "ses-1",
        uri: "file:///workspace/index.ts",
        baseVersion: "10:4",
        languageId: "typescript",
        contentBytes: 7,
        updatedAt: "2026-08-08T00:00:00.000Z",
      })
    }
    return new Response("åhello", {
      status: 200,
      headers: {
        "content-length": "7",
        "content-type": "text/plain; charset=utf-8",
        "x-yaade-recovery-uri": encodeURIComponent(
          "file:///workspace/index.ts",
        ),
        "x-yaade-recovery-base-version": encodeURIComponent("10:4"),
        "x-yaade-recovery-language-id": encodeURIComponent("typescript"),
        "x-yaade-recovery-updated-at": encodeURIComponent(
          "2026-08-08T00:00:00.000Z",
        ),
      },
    })
  })

  const saved = await upsertEditorRecoveryBuffer({
    sessionId: "ses-1",
    uri: "file:///workspace/index.ts",
    content: "åhello",
    baseVersion: "10:4",
    languageId: "typescript",
  })
  assert.equal(saved.contentBytes, 7)
  assert.equal(calls[0]?.method, "PUT")
  assert.equal(calls[0]?.body, "åhello")
  const putUrl = new URL(calls[0]!.url, "http://yaade.test")
  assert.equal(putUrl.searchParams.get("uri"), "file:///workspace/index.ts")
  assert.equal(putUrl.searchParams.get("baseVersion"), "10:4")

  const restored = await getEditorRecoveryBuffer(
    "ses-1",
    "file:///workspace/index.ts",
  )
  assert.deepEqual(restored, {
    sessionId: "ses-1",
    uri: "file:///workspace/index.ts",
    baseVersion: "10:4",
    languageId: "typescript",
    contentBytes: 7,
    updatedAt: "2026-08-08T00:00:00.000Z",
    content: "åhello",
  })
})

test("editor recovery client lists and clears buffers", async () => {
  installFetch(async (input, init) => {
    if (init?.method === "DELETE") {
      const url = input instanceof Request ? input.url : String(input)
      return Response.json({
        ok: true,
        deleted: url.includes("/buffer?") ? true : 2,
      })
    }
    return Response.json([
      {
        sessionId: "ses-1",
        uri: "untitled:first",
        baseVersion: null,
        languageId: "plaintext",
        contentBytes: 5,
        updatedAt: "2026-08-08T00:00:00.000Z",
      },
    ])
  })

  const listed = await listEditorRecoveryBuffers("ses-1")
  assert.equal(listed.length, 1)
  assert.equal(listed[0]?.uri, "untitled:first")
  assert.equal(
    await deleteEditorRecoveryBuffer("ses-1", "untitled:first"),
    true,
  )
  assert.equal(await deleteEditorRecoverySession("ses-1"), 2)
})

test("editor recovery client drains a missing buffer response before returning null", async () => {
  const response = new Response("", {
    status: 200,
    headers: { "x-yaade-recovery-missing": "1" },
  })
  installFetch(async () => response)
  assert.equal(
    await getEditorRecoveryBuffer("ses-1", "untitled:missing"),
    null,
  )
  assert.equal(response.bodyUsed, true)
})
