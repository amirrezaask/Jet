import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { PanelNode } from "@jet/panels"
import type { PanelView } from "@jet/shared"
import { JetPanelTree } from "./panel-tree.js"
import { WorkspaceService } from "./workspace.js"

function countLeaves(tree: JetPanelTree): number {
  let count = 0
  const walk = (node: PanelNode<PanelView>) => {
    if (node.kind === "leaf") count++
    else node.split.children.forEach(walk)
  }
  walk(tree.root)
  return count
}

describe("ensurePanelView", () => {
  it("splits sidebar left instead of replacing the editor panel", () => {
    const { tree, editorPanel } = JetPanelTree.editorOnlyLayout()
    tree.setView(editorPanel, { kind: "editor", fileUri: "file:///tmp/a.ts" })
    const workspace = new WorkspaceService({ readFile: async () => "", writeFile: async () => {}, readDir: async () => [], stat: async () => null })

    const sidebar = workspace.ensurePanelView(tree, editorPanel, "explorer")

    assert.notEqual(sidebar.id, editorPanel.id)
    assert.equal(tree.getView(sidebar)?.kind, "explorer")
    assert.equal(tree.getView(editorPanel)?.kind, "editor")
    assert.equal(countLeaves(tree), 2)
  })

  it("reuses an existing sidebar panel when switching view kind", () => {
    const { tree, editorPanel } = JetPanelTree.editorOnlyLayout()
    tree.setView(editorPanel, { kind: "editor", fileUri: "file:///tmp/a.ts" })
    const workspace = new WorkspaceService({ readFile: async () => "", writeFile: async () => {}, readDir: async () => [], stat: async () => null })

    const explorerPanel = workspace.ensurePanelView(tree, editorPanel, "explorer")
    const locationPanel = workspace.ensurePanelView(tree, editorPanel, "locationlist")

    assert.equal(explorerPanel.id, locationPanel.id)
    assert.equal(tree.getView(locationPanel)?.kind, "locationlist")
    assert.equal(tree.getView(editorPanel)?.kind, "editor")
    assert.equal(countLeaves(tree), 2)
  })
})
