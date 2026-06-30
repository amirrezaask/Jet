import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { PanelTree } from "./tree.js"

function countLeaves(tree: PanelTree): number {
  let count = 0
  const walk = (node: PanelTree["root"]) => {
    if (node.kind === "leaf") count++
    else node.split.children.forEach(walk)
  }
  walk(tree.root)
  return count
}

describe("PanelTree", () => {
  it("editorOnlyLayout yields one leaf", () => {
    const { tree } = PanelTree.editorOnlyLayout()
    assert.equal(countLeaves(tree), 1)
  })

  it("setView and getView round-trip", () => {
    const { tree, editorPanel } = PanelTree.editorOnlyLayout()
    tree.setView(editorPanel, { kind: "explorer" })
    assert.equal(tree.getView(editorPanel)?.kind, "explorer")
  })

  it("pruneEmptyLeaves keeps single empty leaf", () => {
    const { tree, editorPanel } = PanelTree.editorOnlyLayout()
    tree.setView(editorPanel, { kind: "empty" })
    tree.pruneEmptyLeaves()
    assert.equal(countLeaves(tree), 1)
  })
})
