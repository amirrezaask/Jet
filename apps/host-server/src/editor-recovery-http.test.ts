import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, it } from "node:test"
import { pathToFileUri } from "@yaade/shared"
import { loadConfig } from "./config.js"
import { startHostServer } from "./server.js"

describe("editor recovery HTTP API", () => {
  let dir: string
  let origin: string
  let close: () => Promise<void>
  let sessionId: string

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "yaade-recovery-http-"))
    const root = path.join(dir, "workspace")
    fs.mkdirSync(root, { recursive: true })
    const config = await loadConfig([
      root,
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--data-dir",
      path.join(dir, "data"),
      "--allowed-roots",
      dir,
    ])
    const started = await startHostServer(config)
    close = started.close
    origin = `http://127.0.0.1:${started.port}`
    sessionId = started.runtime.db.createProjectSession({
      machine: started.runtime.machineHostname,
      projectPath: root,
      cwdPath: root,
      title: "Recovery HTTP",
    }).id
  })

  afterEach(async () => {
    await close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it("round-trips raw recovery text larger than the JSON RPC limit", async () => {
    const uri = pathToFileUri(path.join(dir, "workspace", "src", "large.ts"))
    const content = `å${"x".repeat(2 * 1024 * 1024 + 17)}`
    const query = new URLSearchParams({
      uri,
      languageId: "typescript",
      baseVersion: "100:2097171",
    })
    const bufferUrl =
      `${origin}/api/v1/project-sessions/${sessionId}` +
      `/editor-recovery/buffer?${query}`

    const put = await fetch(bufferUrl, {
      method: "PUT",
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: content,
    })
    assert.equal(put.status, 200)
    const saved: unknown = await put.json()
    assert.ok(saved && typeof saved === "object" && "contentBytes" in saved)
    assert.equal(saved.contentBytes, Buffer.byteLength(content, "utf8"))

    const get = await fetch(bufferUrl)
    assert.equal(get.status, 200)
    assert.equal(get.headers.get("cache-control"), "no-store")
    assert.equal(
      decodeURIComponent(get.headers.get("x-yaade-recovery-uri") ?? ""),
      uri,
    )
    assert.equal(
      decodeURIComponent(
        get.headers.get("x-yaade-recovery-base-version") ?? "",
      ),
      "100:2097171",
    )
    assert.equal(await get.text(), content)

    const list = await fetch(
      `${origin}/api/v1/project-sessions/${sessionId}/editor-recovery`,
    )
    assert.equal(list.status, 200)
    const listed: unknown = await list.json()
    assert.ok(Array.isArray(listed))
    assert.equal(listed.length, 1)

    const removed = await fetch(bufferUrl, { method: "DELETE" })
    assert.equal(removed.status, 200)
    assert.deepEqual(await removed.json(), { ok: true, deleted: true })
    const missing = await fetch(bufferUrl)
    assert.equal(missing.status, 200)
    assert.equal(missing.headers.get("x-yaade-recovery-missing"), "1")
    assert.equal(await missing.text(), "")
  })

  it("clears every recovery record for a session", async () => {
    const collectionUrl =
      `${origin}/api/v1/project-sessions/${sessionId}/editor-recovery`
    for (const uri of ["untitled:first", "untitled:second"]) {
      const query = new URLSearchParams({ uri, languageId: "plaintext" })
      const response = await fetch(`${collectionUrl}/buffer?${query}`, {
        method: "PUT",
        body: uri,
      })
      assert.equal(response.status, 200)
    }

    const cleared = await fetch(collectionUrl, { method: "DELETE" })
    assert.equal(cleared.status, 200)
    assert.deepEqual(await cleared.json(), { ok: true, deleted: 2 })
    const listed = await fetch(collectionUrl)
    assert.deepEqual(await listed.json(), [])
  })

  it("rejects recovery records for file URIs outside allowed roots", async () => {
    const query = new URLSearchParams({
      uri: pathToFileUri(path.join(os.tmpdir(), "outside-yaade-root.ts")),
      languageId: "typescript",
    })
    const response = await fetch(
      `${origin}/api/v1/project-sessions/${sessionId}/editor-recovery/buffer?${query}`,
      { method: "PUT", body: "outside" },
    )
    assert.equal(response.status, 403)
  })
})
