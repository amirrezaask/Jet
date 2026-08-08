import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  WorkspaceEditConflictError,
  WorkspaceEditTransactionService,
  applyWorkspaceTextEdits,
  searchReplaceRequests,
  type OpenTextDocument,
  type WorkspaceTextEdit,
} from "./workspace-edit-transaction.js"

function edit(startColumn: number, endColumn: number, text: string): WorkspaceTextEdit {
  return {
    range: { startLine: 1, startColumn, endLine: 1, endColumn },
    text,
  }
}

describe("workspace edit transaction", () => {
  it("applies UTF-16 ranges from the end without shifting later matches", () => {
    assert.equal(
      applyWorkspaceTextEdits("one one", [edit(1, 4, "two"), edit(5, 8, "two")]),
      "two two",
    )
    assert.equal(
      applyWorkspaceTextEdits("😀 value", [{
        range: { startLine: 1, startColumn: 4, endLine: 1, endColumn: 9 },
        text: "item",
      }]),
      "😀 item",
    )
  })

  it("preflights, edits open documents without saving, and undoes once", async () => {
    let openText = "const open = 1\n"
    const openDocument: OpenTextDocument = {
      readText: () => openText,
      applyEdits: edits => {
        openText = applyWorkspaceTextEdits(openText, edits)
      },
    }
    const disk = new Map([
      ["file:///closed.ts", { content: "const closed = 1\n", version: "v1" }],
    ])
    let writes = 0
    const transactions = new WorkspaceEditTransactionService({
      getOpenDocument: uri => uri === "file:///open.ts" ? openDocument : null,
      readTextFile: async uri => ({ ...disk.get(uri)!, size: disk.get(uri)!.content.length }),
      writeTextFile: async (uri, content, options) => {
        const current = disk.get(uri)!
        assert.equal(options.expectedVersion, current.version)
        writes++
        const version = `v${writes + 1}`
        disk.set(uri, { content, version })
        return { version, size: content.length }
      },
    })
    const preview = await transactions.preview([
      { uri: "file:///closed.ts", edits: [edit(16, 17, "2")] },
      { uri: "file:///open.ts", edits: [edit(14, 15, "2")] },
    ])
    assert.equal(preview.editCount, 2)
    await transactions.apply(preview)
    assert.equal(disk.get("file:///closed.ts")!.content, "const closed = 2\n")
    assert.equal(openText, "const open = 2\n")
    assert.equal(writes, 1, "the open document was not auto-saved")
    assert.equal(transactions.canUndo(), true)

    assert.equal(await transactions.undoLast(), true)
    assert.equal(disk.get("file:///closed.ts")!.content, "const closed = 1\n")
    assert.equal(openText, "const open = 1\n")
    assert.equal(await transactions.undoLast(), false)
  })

  it("rejects stale previews before mutating any file", async () => {
    let disk = { content: "before", version: "v1" }
    let writes = 0
    const transactions = new WorkspaceEditTransactionService({
      getOpenDocument: () => null,
      readTextFile: async () => ({ ...disk, size: disk.content.length }),
      writeTextFile: async (_uri, content) => {
        writes++
        disk = { content, version: `v${writes + 1}` }
        return { version: disk.version, size: content.length }
      },
    })
    const preview = await transactions.preview([
      { uri: "file:///stale.txt", edits: [edit(1, 7, "after")] },
    ])
    disk = { content: "changed", version: "external" }
    await assert.rejects(() => transactions.apply(preview), WorkspaceEditConflictError)
    assert.equal(writes, 0)
  })

  it("rolls back closed files when a later write fails", async () => {
    const disk = new Map([
      ["file:///a.txt", { content: "a", version: "a1" }],
      ["file:///b.txt", { content: "b", version: "b1" }],
    ])
    let version = 1
    const transactions = new WorkspaceEditTransactionService({
      getOpenDocument: () => null,
      readTextFile: async uri => ({ ...disk.get(uri)!, size: 1 }),
      writeTextFile: async (uri, content, options) => {
        const current = disk.get(uri)!
        assert.equal(options.expectedVersion, current.version)
        if (uri.endsWith("b.txt")) throw new Error("disk full")
        const nextVersion = `a${++version}`
        disk.set(uri, { content, version: nextVersion })
        return { version: nextVersion, size: content.length }
      },
    })
    const preview = await transactions.preview([
      { uri: "file:///a.txt", edits: [edit(1, 2, "A")] },
      { uri: "file:///b.txt", edits: [edit(1, 2, "B")] },
    ])
    await assert.rejects(() => transactions.apply(preview), /disk full/)
    assert.equal(disk.get("file:///a.txt")!.content, "a")
    assert.equal(disk.get("file:///b.txt")!.content, "b")
  })

  it("restores staged disk writes when an open adapter partially fails", async () => {
    let disk = { content: "closed", version: "v1" }
    let openText = "open"
    let failOpenEdit = true
    const transactions = new WorkspaceEditTransactionService({
      getOpenDocument: uri => uri.endsWith("open.txt") ? {
        readText: () => openText,
        applyEdits: edits => {
          openText = applyWorkspaceTextEdits(openText, edits)
          if (failOpenEdit) {
            failOpenEdit = false
            throw new Error("adapter failed")
          }
        },
      } : null,
      readTextFile: async () => ({ ...disk, size: disk.content.length }),
      writeTextFile: async (_uri, content, options) => {
        assert.equal(options.expectedVersion, disk.version)
        disk = { content, version: `${disk.version}-next` }
        return { version: disk.version, size: content.length }
      },
    })
    const preview = await transactions.preview([
      { uri: "file:///closed.txt", edits: [edit(1, 7, "changed")] },
      { uri: "file:///open.txt", edits: [edit(1, 5, "changed")] },
    ])
    await assert.rejects(() => transactions.apply(preview), /adapter failed/)
    assert.equal(disk.content, "closed")
    assert.equal(openText, "open")
  })

  it("groups selected search ranges by workspace file", () => {
    const requests = searchReplaceRequests("file:///repo", [{
      path: "src/a.ts",
      line: 1,
      column: 1,
      preview: "foo foo",
      ranges: [
        { startLine: 1, startColumn: 1, endLine: 1, endColumn: 4 },
        { startLine: 1, startColumn: 5, endLine: 1, endColumn: 8 },
      ],
    }], "bar")
    assert.equal(requests[0]!.uri, "file:///repo/src/a.ts")
    assert.equal(requests[0]!.edits.length, 2)
  })
})
