import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { PanelNode } from "@jet/panels"
import type { PanelView } from "@jet/shared"
import { JetPanelTree } from "./panel-tree.js"
import {
  activatePanelTab,
  buildTabsView,
  popPanelTab,
  pushPanelTab,
  reorderPanelTab,
} from "./panel-tabs.js"

function countLeaves(tree: JetPanelTree): number {
  let count = 0
  const walk = (node: PanelNode<PanelView>) => {
    if (node.kind === "leaf") count++
    else node.split.children.forEach(walk)
  }
  walk(tree.root)
  return count
}

describe("panel tabs", () => {
  it("push appends new tab and activates without reordering", () => {
    const first = buildTabsView("file://a", ["file://a"])
    const second = pushPanelTab(first, "file://b")
    assert.deepEqual(second.tabIds, ["file://a", "file://b"])
    assert.equal(second.activeTabId, "file://b")
  })

  it("push activates existing tab without reordering or duplicate", () => {
    const view = buildTabsView("file://a", ["file://a", "file://b"])
    const next = pushPanelTab(view, "file://b")
    assert.deepEqual(next.tabIds, ["file://a", "file://b"])
    assert.equal(next.activeTabId, "file://b")
  })

  it("activate changes active tab without reordering", () => {
    const view = buildTabsView("file://a", ["file://a", "file://b", "file://c"])
    const next = activatePanelTab(view, "file://c")
    assert.deepEqual(next.tabIds, ["file://a", "file://b", "file://c"])
    assert.equal(next.activeTabId, "file://c")
  })

  it("pop reveals previous tab", () => {
    const view = buildTabsView("file://b", ["file://b", "file://a"])
    const next = popPanelTab(view, "file://b")
    assert.equal(next.kind, "tabs")
    if (next.kind === "tabs") {
      assert.equal(next.activeTabId, "file://a")
      assert.deepEqual(next.tabIds, ["file://a"])
    }
  })

  it("reorder preserves visual order without moving active tab to front", () => {
    const view = buildTabsView("file://b", ["file://b", "file://a"])
    const next = reorderPanelTab(view, "file://a", 0)
    assert.deepEqual(next.tabIds, ["file://a", "file://b"])
    assert.equal(next.activeTabId, "file://b")
  })
})

describe("JetPanelTree tab stacks", () => {
  it("findEditorPanelForFile matches hidden tabs", () => {
    const { tree, editorPanel } = JetPanelTree.editorOnlyLayout()
    tree.setView(editorPanel, buildTabsView("file://b", ["file://b", "file://a"]))
    assert.equal(tree.findEditorPanelForFile("file://a")?.id, editorPanel.id)
  })

  it("pruneEmptyLeaves collapses extra empty leaf", () => {
    const { tree, editorPanel } = JetPanelTree.editorOnlyLayout()
    const splitPanel = tree.splitAtEdge(editorPanel, "right")
    tree.setView(editorPanel, { kind: "empty" })
    tree.setView(splitPanel, buildTabsView("file://x", ["file://x"]))
    tree.pruneEmptyLeaves()
    assert.equal(countLeaves(tree), 1)
    assert.notEqual(tree.findEditorPanelForFile("file://x"), null)
  })
})
