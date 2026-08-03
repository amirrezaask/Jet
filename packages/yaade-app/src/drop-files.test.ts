import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { fileUriToPath } from "@yaade/shared"
import {
  pathsFromDataTransfer,
  resolveDroppedFilesAgainstWorkspaces,
  resolveDropZoneFromElement,
} from "./drop-files.js"

function fakeDataTransfer(opts: {
  files?: Array<{ name: string; path?: string }>
  uriList?: string
  plain?: string
}): DataTransfer {
  const files = opts.files ?? []
  return {
    files: files as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: files.length || opts.uriList ? ["Files"] : [],
    getData(type: string) {
      if (type === "text/uri-list") return opts.uriList ?? ""
      if (type === "text/plain") return opts.plain ?? ""
      return ""
    },
    setData() {},
    clearData() {},
    setDragImage() {},
    dropEffect: "none",
    effectAllowed: "all",
  } as DataTransfer
}

describe("drop-files pathsFromDataTransfer", () => {
  it("reads File.path when present", () => {
    const paths = pathsFromDataTransfer(
      fakeDataTransfer({ files: [{ name: "a.ts", path: "/tmp/a.ts" }] }),
    )
    assert.deepEqual(paths, ["/tmp/a.ts"])
  })

  it("falls back to text/uri-list file URIs", () => {
    const uri = "file:///tmp/my%20file.ts"
    const paths = pathsFromDataTransfer(fakeDataTransfer({ uriList: uri }))
    assert.deepEqual(paths, [fileUriToPath(uri)])
  })

  it("ignores comment lines in uri-list", () => {
    const paths = pathsFromDataTransfer(
      fakeDataTransfer({
        uriList: "# comment\nfile:///tmp/ok.ts\n\n",
      }),
    )
    assert.deepEqual(paths, ["/tmp/ok.ts"])
  })

  it("accepts plain absolute paths in text/plain", () => {
    const paths = pathsFromDataTransfer(
      fakeDataTransfer({ plain: "/Users/me/proj/src/index.ts" }),
    )
    assert.deepEqual(paths, ["/Users/me/proj/src/index.ts"])
  })

  it("ignores empty File.path and falls back to uri-list", () => {
    const paths = pathsFromDataTransfer(
      fakeDataTransfer({
        files: [{ name: "a.ts", path: "" }],
        uriList: "file:///tmp/a.ts",
      }),
    )
    assert.deepEqual(paths, ["/tmp/a.ts"])
  })
})

describe("drop-files resolveDroppedFilesAgainstWorkspaces", () => {
  it("maps pathless File to unique workspace match", async () => {
    const paths = await resolveDroppedFilesAgainstWorkspaces(
      [{ name: "index.ts", size: 12 } as File],
      ["/proj"],
      {
        listFiles: async () => ["src/index.ts", "README.md"],
        statSize: async () => 12,
      },
    )
    assert.deepEqual(paths, ["/proj/src/index.ts"])
  })

  it("uses size to disambiguate duplicate basenames", async () => {
    const paths = await resolveDroppedFilesAgainstWorkspaces(
      [{ name: "index.ts", size: 99 } as File],
      ["/proj"],
      {
        listFiles: async () => ["src/index.ts", "pkg/index.ts"],
        statSize: async abs => (abs.endsWith("pkg/index.ts") ? 99 : 12),
      },
    )
    assert.deepEqual(paths, ["/proj/pkg/index.ts"])
  })

  it("prefers active workspace root when sizes tie", async () => {
    const paths = await resolveDroppedFilesAgainstWorkspaces(
      [{ name: "a.ts", size: 1 } as File],
      ["/a", "/b"],
      {
        listFiles: async () => ["a.ts"],
        statSize: async () => 1,
        activeRoot: "/b",
      },
    )
    assert.deepEqual(paths, ["/b/a.ts"])
  })
})

describe("drop-files resolveDropZoneFromElement", () => {
  it("returns other for null", () => {
    assert.equal(resolveDropZoneFromElement(null), "other")
  })
})
