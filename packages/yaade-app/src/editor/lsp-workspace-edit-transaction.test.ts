import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { JetLspWorkspaceDeps } from "@yaade/lsp"
import type { TrashEntry } from "@yaade/workspace"
import { applyLspWorkspaceEditTransaction } from "./lsp-workspace-edit-transaction.js"
import { WorkspaceEditTransactionService } from "./workspace-edit-transaction.js"

type WorkspaceEdit = Parameters<
  NonNullable<JetLspWorkspaceDeps["applyWorkspaceEditTransaction"]>
>[0]

type DiskFile = { content: string; version: string }

function textEdit(uri: string, newText: string): WorkspaceEdit {
  return {
    changes: {
      [uri]: [{
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText,
      }],
    },
  }
}

function createHarness(
  initial: Record<string, string>,
  options: { failWrite?: (uri: string) => boolean } = {},
) {
  const disk = new Map<string, DiskFile>(
    Object.entries(initial).map(([uri, content], index) => [
      uri,
      { content, version: `v${index + 1}` },
    ]),
  )
  const trash = new Map<string, { entry: TrashEntry; file: DiskFile }>()
  let version = disk.size + 1
  let trashId = 1

  const fs = {
    readTextFile: async (uri: string) => {
      const file = disk.get(uri)
      if (!file) throw new Error(`missing: ${uri}`)
      return { ...file, size: file.content.length }
    },
    exists: async (uri: string) => disk.has(uri),
    stat: async (uri: string) => {
      const file = disk.get(uri)
      if (!file) throw new Error(`missing: ${uri}`)
      return { uri, isDirectory: false, size: file.content.length }
    },
    readDir: async () => [],
    createFile: async (uri: string) => {
      if (disk.has(uri)) throw new Error(`exists: ${uri}`)
      disk.set(uri, { content: "", version: `v${version++}` })
      return { uri, isDirectory: false, size: 0 }
    },
    rename: async (oldUri: string, newUri: string) => {
      const file = disk.get(oldUri)
      if (!file) throw new Error(`missing: ${oldUri}`)
      if (disk.has(newUri)) throw new Error(`exists: ${newUri}`)
      disk.delete(oldUri)
      disk.set(newUri, file)
      return { uri: newUri, isDirectory: false, size: file.content.length }
    },
    trash: async (uri: string) => {
      const file = disk.get(uri)
      if (!file) throw new Error(`missing: ${uri}`)
      const id = `trash-${trashId++}`
      const entry: TrashEntry = {
        id,
        originalUri: uri,
        name: uri.slice(uri.lastIndexOf("/") + 1),
        isDirectory: false,
        size: file.content.length,
        trashedAt: Date.now(),
      }
      disk.delete(uri)
      trash.set(id, { entry, file })
      return entry
    },
    restoreTrash: async (id: string, targetUri?: string) => {
      const item = trash.get(id)
      if (!item) throw new Error(`missing trash: ${id}`)
      const uri = targetUri ?? item.entry.originalUri
      if (disk.has(uri)) throw new Error(`exists: ${uri}`)
      disk.set(uri, item.file)
      trash.delete(id)
      return { entry: item.entry, uri }
    },
  }

  const transactions = new WorkspaceEditTransactionService({
    getOpenDocument: () => null,
    readTextFile: fs.readTextFile,
    writeTextFile: async (uri, content, writeOptions) => {
      const file = disk.get(uri)
      if (!file) throw new Error(`missing: ${uri}`)
      assert.equal(writeOptions.expectedVersion, file.version)
      if (options.failWrite?.(uri)) throw new Error("write failed")
      const next = { content, version: `v${version++}` }
      disk.set(uri, next)
      return { version: next.version, size: content.length }
    },
  })

  return {
    disk,
    dependencies: {
      fs,
      transactions,
      getOpenDocument: () => null,
      isOpen: () => false,
      isDirty: () => false,
      isUriAllowed: (uri: string) => uri.startsWith("file:///repo/"),
      getDocumentVersion: () => undefined,
    },
  }
}

describe("LSP workspace edit transaction", () => {
  it("creates a resource before applying its text edits", async () => {
    const { disk, dependencies } = createHarness({})
    const uri = "file:///repo/new.ts"
    const edit: WorkspaceEdit = {
      documentChanges: [
        { kind: "create", uri },
        {
          textDocument: { uri, version: null },
          edits: [{
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            newText: "export const value = 1\n",
          }],
        },
      ],
    }

    assert.deepEqual(
      await applyLspWorkspaceEditTransaction(edit, { atomic: true }, dependencies),
      { applied: true },
    )
    assert.equal(disk.get(uri)?.content, "export const value = 1\n")
  })

  it("preserves lazily loaded source content when rename is followed by text edits", async () => {
    const oldUri = "file:///repo/old.ts"
    const newUri = "file:///repo/new.ts"
    const { disk, dependencies } = createHarness({ [oldUri]: "const value = 1\n" })
    const edit: WorkspaceEdit = {
      documentChanges: [
        { kind: "rename", oldUri, newUri },
        {
          textDocument: { uri: newUri, version: null },
          edits: [{
            range: {
              start: { line: 0, character: 14 },
              end: { line: 0, character: 15 },
            },
            newText: "2",
          }],
        },
      ],
    }

    assert.deepEqual(
      await applyLspWorkspaceEditTransaction(edit, { atomic: true }, dependencies),
      { applied: true },
    )
    assert.equal(disk.has(oldUri), false)
    assert.equal(disk.get(newUri)?.content, "const value = 2\n")
  })

  it("reconciles a clean open buffer after a resource rename", async () => {
    const oldUri = "file:///repo/open.ts"
    const newUri = "file:///repo/renamed.ts"
    const { disk, dependencies } = createHarness({ [oldUri]: "before" })
    const reconciled: string[][] = []
    const result = await applyLspWorkspaceEditTransaction(
      { documentChanges: [{ kind: "rename", oldUri, newUri }] },
      { atomic: true },
      {
        ...dependencies,
        isOpen: uri => uri === oldUri,
        prepareOpenResourceReconciliation: async operations => ({
          apply: () => {
            reconciled.push(operations.flatMap(operation =>
              operation.kind === "rename"
                ? [operation.oldUri, operation.newUri]
                : [operation.uri],
            ))
          },
          rollback: () => {},
        }),
      },
    )

    assert.deepEqual(result, { applied: true })
    assert.deepEqual(reconciled, [[oldUri, newUri]])
    assert.equal(disk.has(oldUri), false)
    assert.equal(disk.get(newUri)?.content, "before")
  })

  it("rolls a rename back when its staged text write fails", async () => {
    const oldUri = "file:///repo/old.ts"
    const newUri = "file:///repo/new.ts"
    const { disk, dependencies } = createHarness(
      { [oldUri]: "before" },
      { failWrite: uri => uri === newUri },
    )
    const edit: WorkspaceEdit = {
      documentChanges: [
        { kind: "rename", oldUri, newUri },
        ...((textEdit(newUri, "changed").changes
          ? [{
              textDocument: { uri: newUri, version: null },
              edits: textEdit(newUri, "changed").changes![newUri]!,
            }]
          : [])),
      ],
    }

    const result = await applyLspWorkspaceEditTransaction(
      edit,
      { atomic: true },
      dependencies,
    )
    assert.equal(result.applied, false)
    assert.match(result.reason ?? "", /write failed/)
    assert.equal(disk.get(oldUri)?.content, "before")
    assert.equal(disk.has(newUri), false)
  })

  it("rolls open-buffer reconciliation back after restoring disk resources", async () => {
    const oldUri = "file:///repo/open.ts"
    const newUri = "file:///repo/renamed.ts"
    const { disk, dependencies } = createHarness(
      { [oldUri]: "before" },
      { failWrite: uri => uri === newUri },
    )
    let rollbackSawRestoredDisk = false
    const result = await applyLspWorkspaceEditTransaction(
      {
        documentChanges: [
          { kind: "rename", oldUri, newUri },
          {
            textDocument: { uri: newUri, version: null },
            edits: [{
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 6 },
              },
              newText: "after",
            }],
          },
        ],
      },
      { atomic: true },
      {
        ...dependencies,
        isOpen: uri => uri === oldUri,
        prepareOpenResourceReconciliation: async () => ({
          apply: () => {},
          rollback: () => {
            rollbackSawRestoredDisk =
              disk.get(oldUri)?.content === "before" && !disk.has(newUri)
          },
        }),
      },
    )

    assert.equal(result.applied, false)
    assert.equal(rollbackSawRestoredDisk, true)
  })

  it("deletes resources through recoverable trash", async () => {
    const uri = "file:///repo/obsolete.ts"
    const { disk, dependencies } = createHarness({ [uri]: "obsolete" })
    const result = await applyLspWorkspaceEditTransaction(
      { documentChanges: [{ kind: "delete", uri }] },
      { atomic: true },
      dependencies,
    )
    assert.deepEqual(result, { applied: true })
    assert.equal(disk.has(uri), false)
  })

  it("restores an overwritten rename target when a later write fails", async () => {
    const oldUri = "file:///repo/old.ts"
    const newUri = "file:///repo/new.ts"
    const { disk, dependencies } = createHarness(
      { [oldUri]: "source", [newUri]: "target" },
      { failWrite: uri => uri === newUri },
    )
    const result = await applyLspWorkspaceEditTransaction(
      {
        documentChanges: [
          { kind: "rename", oldUri, newUri, options: { overwrite: true } },
          {
            textDocument: { uri: newUri, version: null },
            edits: [{
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 6 },
              },
              newText: "changed",
            }],
          },
        ],
      },
      { atomic: true },
      dependencies,
    )
    assert.equal(result.applied, false)
    assert.match(result.reason ?? "", /write failed/)
    assert.equal(disk.get(oldUri)?.content, "source")
    assert.equal(disk.get(newUri)?.content, "target")
  })

  it("rejects stale versions before applying planned resource operations", async () => {
    const oldUri = "file:///repo/old.ts"
    const newUri = "file:///repo/new.ts"
    const { disk, dependencies } = createHarness({ [oldUri]: "before" })
    const result = await applyLspWorkspaceEditTransaction(
      {
        documentChanges: [
          { kind: "rename", oldUri, newUri },
          {
            textDocument: { uri: newUri, version: 1 },
            edits: [{
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 6 },
              },
              newText: "after",
            }],
          },
        ],
      },
      { atomic: true },
      { ...dependencies, getDocumentVersion: () => 2 },
    )
    assert.equal(result.applied, false)
    assert.match(result.reason ?? "", /version mismatch/)
    assert.equal(disk.get(oldUri)?.content, "before")
    assert.equal(disk.has(newUri), false)
  })

  it("rejects a disk race between planning and the final transaction preview", async () => {
    const uri = "file:///repo/raced.ts"
    const { disk, dependencies } = createHarness({ [uri]: "before" })
    const readTextFile = dependencies.fs.readTextFile
    let reads = 0
    dependencies.fs.readTextFile = async candidate => {
      const result = await readTextFile(candidate)
      reads += 1
      if (reads === 1) {
        disk.set(uri, { content: "external", version: "external" })
      }
      return result
    }

    const result = await applyLspWorkspaceEditTransaction(
      textEdit(uri, "changed"),
      { atomic: true },
      dependencies,
    )
    assert.equal(result.applied, false)
    assert.match(result.reason ?? "", /changed while the workspace edit was being prepared/)
    assert.equal(disk.get(uri)?.content, "external")
  })

  it("rejects dirty and out-of-root mutations before touching disk", async () => {
    const uri = "file:///repo/a.ts"
    const { disk, dependencies } = createHarness({ [uri]: "before" })
    const dirty = {
      ...dependencies,
      isDirty: (candidate: string) => candidate === uri,
    }
    const dirtyResult = await applyLspWorkspaceEditTransaction(
      textEdit(uri, "changed"),
      { atomic: true },
      dirty,
    )
    assert.equal(dirtyResult.applied, false)
    assert.match(dirtyResult.reason ?? "", /dirty buffer/)

    const outside = "file:///outside/a.ts"
    const outsideResult = await applyLspWorkspaceEditTransaction(
      textEdit(outside, "changed"),
      { atomic: true },
      dependencies,
    )
    assert.equal(outsideResult.applied, false)
    assert.match(outsideResult.reason ?? "", /outside the active roots/)
    assert.equal(disk.get(uri)?.content, "before")
  })
})
