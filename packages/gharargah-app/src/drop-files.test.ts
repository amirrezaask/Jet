import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { fileUriToPath } from "@gharargah/shared"
import { pathsFromDataTransfer, resolveDropZoneFromElement } from "./drop-files.js"

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
})

describe("drop-files resolveDropZoneFromElement", () => {
  it("returns other for null", () => {
    assert.equal(resolveDropZoneFromElement(null), "other")
  })
})
