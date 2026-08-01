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

  it("stops every live server and releases the crash subscription", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { gharargah: { fs: { async stat() { throw new Error("ENOENT") } } } },
    })

    const stopped: string[] = []
    let crashListenerDisposed = false
    const manager = new LanguageServerManager({
      async start(_rootUri, serverId) {
        return { id: `${serverId}-1`, transportUrl: `/ws/lsp/${serverId}-1` }
      },
      async stop(id) {
        stopped.push(id)
      },
      onCrashed() {
        return () => {
          crashListenerDisposed = true
        }
      },
    })

    const rootUri = pathToFileUri("/work/project")
    await manager.ensureServerForFile({
      uri: pathToFileUri("/work/project/src/index.ts"),
      path: "/work/project/src/index.ts",
      languageId: "typescript",
      name: "index.ts",
      isDirty: false,
    }, rootUri)
    await manager.ensureServerForFile({
      uri: pathToFileUri("/work/project/main.go"),
      path: "/work/project/main.go",
      languageId: "go",
      name: "main.go",
      isDirty: false,
    }, rootUri)

    const ids = await manager.stopAll()
    manager.dispose()

    assert.deepEqual([...ids].sort(), ["gopls-1", "typescript-language-server-1"])
    assert.deepEqual([...stopped].sort(), [...ids].sort())
    assert.equal(manager.hasAnyConnection(), false)
    assert.equal(crashListenerDisposed, true)
  })

  it("stops a deferred start that resolves after teardown without re-registering it", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { gharargah: { fs: { async stat() { throw new Error("ENOENT") } } } },
    })

    let resolveStart!: (value: { id: string; transportUrl: string }) => void
    let announceStart!: () => void
    const startCalled = new Promise<void>(resolve => { announceStart = resolve })
    const stopped: string[] = []
    const manager = new LanguageServerManager({
      start: () => new Promise(resolve => {
        resolveStart = resolve
        announceStart()
      }),
      async stop(id) { stopped.push(id) },
    })
    const rootUri = pathToFileUri("/work/project")
    const pending = manager.ensureServerForFile({
      uri: pathToFileUri("/work/project/src/index.ts"),
      path: "/work/project/src/index.ts",
      languageId: "typescript",
      name: "index.ts",
      isDirty: false,
    } as WorkspaceFile, rootUri)

    await startCalled
    await manager.stopAll()
    manager.dispose()
    resolveStart({ id: "late-tsls", transportUrl: "/ws/lsp/late-tsls" })

    assert.equal(await pending, null)
    assert.deepEqual(stopped, ["late-tsls"])
    assert.equal(manager.hasAnyConnection(), false)
  })
})
