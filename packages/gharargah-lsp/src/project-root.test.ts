import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { fileUriToPath, pathToFileUri } from "@gharargah/shared"
import { findProjectRoot, parentDir } from "./project-root.js"

function mockFs(existing: string[]): { stat(uri: string): Promise<{ isFile: boolean }> } {
  const set = new Set<string>(existing.map(p => pathToFileUri(p)))
  return {
    async stat(uri: string) {
      if (set.has(uri)) return { isFile: true }
      throw new Error("ENOENT")
    },
  }
}

describe("project-root", () => {
  it("parentDir strips the last path segment", () => {
    assert.equal(parentDir("/Users/dev/loki/src/main.rs"), "/Users/dev/loki/src")
    assert.equal(parentDir("/Users/dev/loki"), "/Users/dev")
  })

  it("findProjectRoot walks up from file directory to Cargo.toml", async () => {
    const fs = mockFs(["/Users/dev/loki/Cargo.toml"])
    const root = await findProjectRoot(
      "/Users/dev/loki/src",
      ["Cargo.toml"],
      fs,
    )
    assert.equal(root, "/Users/dev/loki")
  })

  it("findProjectRoot finds nested ts project when workspace is parent folder", async () => {
    const fs = mockFs([
      "/Users/dev/fixtures/sample-workspace/package.json",
      "/Users/dev/fixtures/sample-workspace/tsconfig.json",
    ])
    const root = await findProjectRoot(
      "/Users/dev/fixtures/sample-workspace/src",
      ["package.json", "tsconfig.json"],
      fs,
    )
    assert.equal(root, "/Users/dev/fixtures/sample-workspace")
  })

  it("findProjectRoot returns null when no marker exists in ancestry", async () => {
    const fs = mockFs(["/Users/dev/loki/Cargo.toml"])
    const root = await findProjectRoot("/Users/dev/other/src", ["Cargo.toml"], fs)
    assert.equal(root, null)
  })

  it("findProjectRoot without fs returns startPath (browser stub path)", async () => {
    const start = "/Users/dev/loki/src"
    assert.equal(await findProjectRoot(start, ["Cargo.toml"], null), start)
  })

  it("findProjectRoot starts from file dir not workspace root", async () => {
    const projectRoot = "/Users/dev/loki"
    const fs = mockFs([`${projectRoot}/Cargo.toml`])
    const filePath = fileUriToPath(pathToFileUri(`${projectRoot}/src/main.rs`))
    const root = await findProjectRoot(parentDir(filePath), ["Cargo.toml"], fs)
    assert.equal(root, projectRoot)
  })
})
