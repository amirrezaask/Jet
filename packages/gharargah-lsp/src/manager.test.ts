import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"
import { pathToFileUri } from "@gharargah/shared"
import type { WorkspaceFile } from "@gharargah/workspace"

import { LanguageServerManager } from "./manager.js"

const originalWindow = globalThis.window

afterEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  })
})

describe("LanguageServerManager", () => {
  it("starts one gopls process for concurrent attaches and falls back to the workspace root", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        gharargah: {
          fs: {
            async stat() {
              throw new Error("ENOENT")
            },
          },
        },
      },
    })

    const workspaceRootUri = pathToFileUri("/work/go-project")
    const file = {
      uri: pathToFileUri("/work/go-project/src/main.go"),
      path: "/work/go-project/src/main.go",
      languageId: "go",
      name: "main.go",
      isDirty: false,
    } as WorkspaceFile
    let starts = 0
    const manager = new LanguageServerManager({
      async start(rootUri, serverId) {
        starts++
        await Promise.resolve()
        assert.equal(rootUri, workspaceRootUri)
        assert.equal(serverId, "gopls")
        return { id: "gopls-1", transportUrl: "/ws/lsp/gopls-1" }
      },
      async stop() {},
    })

    const [first, second] = await Promise.all([
      manager.ensureServerForFile(file, workspaceRootUri),
      manager.ensureServerForFile(file, workspaceRootUri),
    ])

    assert.equal(starts, 1)
    assert.equal(first, second)
    assert.equal(first?.projectRootUri, workspaceRootUri)
  })
})
