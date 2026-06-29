import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { tabId } from "@jet/shared"
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

function allLeavesEmpty(tree: PanelTree): boolean {
  let allEmpty = true
  const walk = (node: PanelTree["root"]) => {
    if (node.kind === "leaf") {
      if (node.group.tabs.length > 0) allEmpty = false
    } else node.split.children.forEach(walk)
  }
  walk(tree.root)
  return allEmpty
}

describe("PanelTree.sanitizeKnownTabs", () => {
  it("terminates when all tab ids are unknown and yields one empty leaf", () => {
    const { tree, sidebarPanel, editorPanel } = PanelTree.workspaceLayout()
    tree.insertTab(sidebarPanel, tabId(1))
    tree.insertTab(sidebarPanel, tabId(2))
    tree.insertTab(editorPanel, tabId(3))

    const start = performance.now()
    tree.sanitizeKnownTabs(() => false)
    const elapsed = performance.now() - start

    assert.ok(elapsed < 100, `sanitizeKnownTabs took ${elapsed}ms`)
    assert.equal(countLeaves(tree), 1)
    assert.ok(allLeavesEmpty(tree))
  })

  it("does not loop on a single empty root leaf", () => {
    const { tree } = PanelTree.editorOnlyLayout()

    const start = performance.now()
    tree.sanitizeKnownTabs(() => false)
    const elapsed = performance.now() - start

    assert.ok(elapsed < 50, `sanitizeKnownTabs took ${elapsed}ms`)
    assert.equal(countLeaves(tree), 1)
    assert.ok(allLeavesEmpty(tree))
  })

  it("keeps panels that still have known tabs", () => {
    const { tree, sidebarPanel, editorPanel } = PanelTree.workspaceLayout()
    const known = tabId(10)
    tree.insertTab(sidebarPanel, tabId(1))
    tree.insertTab(editorPanel, known)

    tree.sanitizeKnownTabs(id => id.id === known.id)

    assert.equal(countLeaves(tree), 1)
    const editorLeaf = tree.getLeaf(editorPanel)
    assert.equal(editorLeaf?.group.tabs.length, 1)
    assert.equal(editorLeaf?.group.tabs[0]?.id, known.id)
  })
})
