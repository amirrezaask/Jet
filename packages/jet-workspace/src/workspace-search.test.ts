import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { pathToFileUri } from "@jet/shared"
import {
  aggregateFolderSearchState,
  formatQuickOpenDisplayPath,
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
