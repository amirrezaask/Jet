import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { LspConnection } from "./manager.js"
import { DocumentRouter } from "./document-router.js"

function connection(id: string, projectRootUri: string): LspConnection {
  return {
    id,
    rootUri: "file:///workspace",
    projectRootUri,
    languageIds: ["typescript"],
    transportUrl: `/ws/lsp/${id}`,
    descriptorId: "typescript-language-server",
    catalogVersion: 1,
  }
}

describe("DocumentRouter", () => {
  it("selects the longest project root and transfers ownership in close/open order", async () => {
    const calls: string[] = []
    const router = new DocumentRouter({
      async open(owner, uri) { calls.push(`open:${owner.id}:${uri}`); return true },
      close(owner, uri) { calls.push(`close:${owner}:${uri}`) },
    })
    const uri = "file:///workspace/packages/core/src/index.ts"
    const outer = connection("outer", "file:///workspace")
    const nested = connection("nested", "file:///workspace/packages/core")

    assert.equal((await router.route(uri, "typescript", [outer]))?.id, "outer")
    assert.equal((await router.route(uri, "typescript", [outer, nested]))?.id, "nested")
    assert.deepEqual(calls, [
      `open:outer:${uri}`,
      `close:outer:${uri}`,
      `open:nested:${uri}`,
    ])
    assert.equal(router.owner(uri), "nested")
  })

  it("does not open unsupported or sibling-root documents", async () => {
    const router = new DocumentRouter({
      async open() { throw new Error("must not open") },
      close() {},
    })
    assert.equal(
      await router.route(
        "file:///workspace-other/index.ts",
        "typescript",
        [connection("workspace", "file:///workspace")],
      ),
      null,
    )
  })
})
