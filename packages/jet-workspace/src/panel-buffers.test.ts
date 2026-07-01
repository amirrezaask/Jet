import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { PanelTree } from "@jet/panels"
import type { PanelNode } from "@jet/shared"
import {
  buildEditorView,
  popPanelBufferView,
  pushPanelBufferView,
} from "./panel-buffers.js"

function countLeaves(tree: PanelTree): number {
  let count = 0
  const walk = (node: PanelNode) => {
    if (node.kind === "leaf") count++
    else node.split.children.forEach(walk)
  }
  walk(tree.root)
  return count
}

describe("panel buffers", () => {
  it("push prepends active buffer MRU", () => {
    const first = buildEditorView("file://a", ["file://a"])
    const second = pushPanelBufferView(first, "file://b")
    assert.deepEqual(second.buffers, ["file://b", "file://a"])
    assert.equal(second.fileUri, "file://b")
  })

  it("push activates existing buffer without duplicate", () => {
    const view = buildEditorView("file://a", ["file://a", "file://b"])
    const next = pushPanelBufferView(view, "file://b")
    assert.deepEqual(next.buffers, ["file://b", "file://a"])
  })

  it("pop reveals previous buffer", () => {
    const view = buildEditorView("file://b", ["file://b", "file://a"])
    const next = popPanelBufferView(view, "file://b")
    assert.equal(next.kind, "editor")
    if (next.kind === "editor") {
      assert.equal(next.fileUri, "file://a")
      assert.deepEqual(next.buffers, ["file://a"])
    }
  })

  it("pop last buffer yields empty", () => {
    const view = buildEditorView("file://a", ["file://a"])
    assert.deepEqual(popPanelBufferView(view, "file://a"), { kind: "empty" })
  })
})

describe("PanelTree editor buffers", () => {
  it("findEditorPanelForFile matches hidden buffers", () => {
    const { tree, editorPanel } = PanelTree.editorOnlyLayout()
    tree.setView(editorPanel, buildEditorView("file://b", ["file://b", "file://a"]))
    assert.equal(tree.findEditorPanelForFile("file://a")?.id, editorPanel.id)
  })

  it("pruneEmptyLeaves collapses extra empty leaf", () => {
    const { tree, editorPanel } = PanelTree.editorOnlyLayout()
    const splitPanel = tree.splitAtEdge(editorPanel, "right")
    tree.setView(editorPanel, { kind: "empty" })
    tree.setView(splitPanel, buildEditorView("file://x", ["file://x"]))
    tree.pruneEmptyLeaves()
    assert.equal(countLeaves(tree), 1)
    assert.notEqual(tree.findEditorPanelForFile("file://x"), null)
  })
})
