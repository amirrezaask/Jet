import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { PanelNode } from "@jet/panels"
import type { PanelView } from "@jet/shared"
import { EXPLORER_TAB_ID } from "./tab-registry.js"
import { buildTabsView } from "./panel-tabs.js"
import { JetPanelTree } from "./panel-tree.js"
import { WorkspaceManager } from "./workspace-manager.js"
import { WorkspaceService } from "./workspace.js"

function mockWorkspace(): WorkspaceService {
  const mgr = new WorkspaceManager({
    readFile: async () => "",
    writeFile: async () => {},
    readDir: async () => [],
    stat: async () => ({ uri: "", isDirectory: false, size: 0 }),
  })
  return new WorkspaceService(mgr)
}

function countLeaves(tree: JetPanelTree): number {
  let count = 0
  const walk = (node: PanelNode<PanelView>) => {
    if (node.kind === "leaf") count++
    else node.split.children.forEach(walk)
  }
  walk(tree.root)
  return count
}

describe("openOrFocusTab", () => {
  it("mounts explorer as a tab without replacing the editor panel", () => {
    const { tree, editorPanel } = JetPanelTree.editorOnlyLayout()
    tree.setView(editorPanel, buildTabsView("file:///tmp/a.ts", ["file:///tmp/a.ts"]))
    const workspace = mockWorkspace()
    workspace.tabRegistry.register({ id: "file:///tmp/a.ts", kind: "editor", label: "a.ts" })

    const sidebar = tree.attachAtViewportEdge("left")
    workspace.mountExplorerTab(tree, sidebar)

    assert.notEqual(sidebar.id, editorPanel.id)
    assert.equal(tree.getView(sidebar)?.kind, "tabs")
    assert.equal(tree.getView(editorPanel)?.kind, "tabs")
    assert.equal(countLeaves(tree), 2)
  })

  it("reuses an existing tab when openOrFocusTab is called again", () => {
    const { tree, editorPanel } = JetPanelTree.editorOnlyLayout()
    tree.setView(editorPanel, buildTabsView("file:///tmp/a.ts", ["file:///tmp/a.ts"]))
    const workspace = mockWorkspace()
    workspace.tabRegistry.register({ id: "file:///tmp/a.ts", kind: "editor", label: "a.ts" })

    const sidebar = tree.attachAtViewportEdge("left")
    workspace.mountExplorerTab(tree, sidebar)
    workspace.openOrFocusTab(tree, sidebar, workspace.explorerTab())

    assert.equal(tree.getView(sidebar)?.kind, "tabs")
    const view = tree.getView(sidebar)!
    assert.equal(view.kind, "tabs")
    if (view.kind === "tabs") {
      assert.equal(view.activeTabId, EXPLORER_TAB_ID)
    }
  })
})
