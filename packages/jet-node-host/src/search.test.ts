import assert from "node:assert/strict"
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

  it("probeFffAvailable reports native module load", async () => {
    assert.equal(await probeFffAvailable(), true)
  })
})
