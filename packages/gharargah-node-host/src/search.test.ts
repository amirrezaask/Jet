import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it } from "node:test"
import { pathToUri } from "./paths.js"
import { fileSearch, projectSearch } from "./search.js"
import { probeFffAvailable } from "./fff-service.js"

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..")
const sampleRootUri = pathToUri(path.join(repoRoot, "fixtures/sample-workspace"))

describe("search", () => {
  it("fileSearch returns matches for workspace query", async () => {
    const results = await fileSearch(sampleRootUri, "index", { pageSize: 10 })
    assert.ok(Array.isArray(results))
    assert.ok(results.length > 0)
  })

  it("projectSearch returns matches for plain query", async () => {
    const results = await projectSearch(sampleRootUri, "export", { fuzzy: false })
    assert.ok(Array.isArray(results))
    assert.ok(results.length > 0)
  })

  it("fileSearch returns empty for non-git folders", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jet-nogit-"))
    try {
      const rootUri = pathToUri(dir)
      assert.deepEqual(await fileSearch(rootUri, "index", { pageSize: 10 }), [])
      assert.deepEqual(await projectSearch(rootUri, "export"), [])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it("probeFffAvailable reports native module load", async () => {
    assert.equal(await probeFffAvailable(), true)
  })
})
