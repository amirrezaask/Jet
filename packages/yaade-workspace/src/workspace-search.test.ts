import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { pathToFileUri } from "@yaade/shared"
import {
  aggregateFolderSearchState,
  formatQuickOpenDisplayPath,
  projectSearchPageAcrossFolders,
  relativePathInFolder,
  resolveQuickOpenDisplayPath,
} from "./workspace-search.js"

const folderA = {
  id: "a",
  root: { uri: pathToFileUri("/proj/a"), path: "/proj/a", name: "alpha" },
}
const folderB = {
  id: "b",
  root: { uri: pathToFileUri("/proj/b"), path: "/proj/b", name: "beta" },
}

describe("aggregateFolderSearchState", () => {
  it("is supported when any folder supports search", () => {
    const states = new Map([
      ["a", { supported: false, scanReady: true }],
      ["b", { supported: true, scanReady: false }],
    ])
    const agg = aggregateFolderSearchState([folderA, folderB], states)
    assert.equal(agg.supported, true)
    assert.equal(agg.scanReady, false)
  })

  it("is scan ready when at least one supported folder is ready", () => {
    const states = new Map([
      ["a", { supported: true, scanReady: true }],
      ["b", { supported: true, scanReady: false }],
    ])
    const agg = aggregateFolderSearchState([folderA, folderB], states)
    assert.equal(agg.scanReady, true)
  })
})

describe("quick open path helpers", () => {
  it("formats multi-root display paths with folder prefix", () => {
    assert.equal(
      formatQuickOpenDisplayPath(folderA, "src/index.ts", true),
      "alpha/src/index.ts",
    )
    assert.equal(formatQuickOpenDisplayPath(folderA, "src/index.ts", false), "src/index.ts")
  })

  it("resolves multi-root display paths back to file URIs", () => {
    const resolved = resolveQuickOpenDisplayPath("beta/src/util.ts", [folderA, folderB])
    assert.ok(resolved)
    assert.equal(resolved.folder.id, "b")
    assert.equal(resolved.fullPath, "/proj/b/src/util.ts")
    assert.equal(resolved.fileUri, pathToFileUri("/proj/b/src/util.ts"))
  })

  it("resolves single-root relative paths", () => {
    const resolved = resolveQuickOpenDisplayPath("src/index.ts", [folderA])
    assert.ok(resolved)
    assert.equal(resolved.fullPath, "/proj/a/src/index.ts")
  })
})

describe("relativePathInFolder", () => {
  it("returns relative path for files under folder", () => {
    assert.equal(relativePathInFolder("/proj/a", "/proj/a/src/x.ts"), "src/x.ts")
    assert.equal(relativePathInFolder("/proj/a", "/proj/b/x.ts"), undefined)
  })
})

describe("projectSearchPageAcrossFolders", () => {
  it("propagates cancellation/options and reports host truncation", async () => {
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined
    const page = await projectSearchPageAcrossFolders(
      [folderA],
      {
        project: async (_rootUri, _query, options, signal) => {
          assert.deepEqual(options, {
            wholeWord: true,
            include: ["src/**"],
            exclude: ["**/*.test.ts"],
          })
          receivedSignal = signal
          return {
            items: [{
              path: "src/index.ts",
              line: 1,
              column: 1,
              preview: "export const value = 1",
              ranges: [{ startLine: 1, startColumn: 1, endLine: 1, endColumn: 7 }],
            }],
            truncated: true,
          }
        },
      },
      "export",
      { wholeWord: true, include: ["src/**"], exclude: ["**/*.test.ts"] },
      controller.signal,
    )
    assert.equal(receivedSignal, controller.signal)
    assert.equal(page.items.length, 1)
    assert.equal(page.truncated, true)
  })
})
