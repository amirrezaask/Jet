import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { YaadePanelTree, WorkspaceService, WorkspaceManager } from "@yaade/workspace"
import { registerTerminalSession, clearTerminalSession } from "./tabs/terminal-session.js"
import {
  hideSessionFromLayout,
  openSessionInLayout,
  terminalOnlyView,
} from "./session-layout.js"
import { findPanelWithTab, panelTabIds } from "@yaade/workspace"

function makeWorkspace() {
  return new WorkspaceService(new WorkspaceManager())
}

describe("session-layout", () => {
  it("openSessionInLayout focuses existing tab (1A)", () => {
    const workspace = makeWorkspace()
    const { tree, editorPanel } = YaadePanelTree.editorOnlyLayout()
    registerTerminalSession("yaade:terminal:a", "file:///tmp/a")
    workspace.registerTab({ id: "yaade:terminal:a", kind: "terminal", label: "A" })
    const first = openSessionInLayout(workspace, tree, "yaade:terminal:a", editorPanel)
    assert.equal(first.created, true)
    registerTerminalSession("yaade:terminal:b", "file:///tmp/b")
    workspace.registerTab({ id: "yaade:terminal:b", kind: "terminal", label: "B" })
    openSessionInLayout(workspace, tree, "yaade:terminal:b", first.panelId)
    const again = openSessionInLayout(workspace, tree, "yaade:terminal:a", first.panelId)
    assert.equal(again.created, false)
    assert.equal(again.panelId.id, first.panelId.id)
    const view = tree.getView(again.panelId)
    assert.equal(view?.kind, "tabs")
    if (view?.kind === "tabs") assert.equal(view.activeTabId, "yaade:terminal:a")
    clearTerminalSession("yaade:terminal:a")
    clearTerminalSession("yaade:terminal:b")
  })

  it("hideSessionFromLayout removes tab without clearing session store (2A)", () => {
    const workspace = makeWorkspace()
    const { tree, editorPanel } = YaadePanelTree.editorOnlyLayout()
    registerTerminalSession("yaade:terminal:c", "file:///tmp/c")
    workspace.registerTab({ id: "yaade:terminal:c", kind: "terminal", label: "C" })
    const opened = openSessionInLayout(workspace, tree, "yaade:terminal:c", editorPanel)
    hideSessionFromLayout(tree, opened.panelId, "yaade:terminal:c")
    assert.equal(findPanelWithTab(tree, "yaade:terminal:c"), null)
    // Session remains registered for sidebar reopen.
    assert.ok(workspace.tabRegistry.get("yaade:terminal:c"))
    clearTerminalSession("yaade:terminal:c")
  })

  it("terminalOnlyView filters file tabs", () => {
    const view = terminalOnlyView({
      kind: "tabs",
      activeTabId: "file:///a.ts",
      tabIds: ["file:///a.ts", "yaade:terminal:x"],
    })
    assert.deepEqual(panelTabIds(view), ["yaade:terminal:x"])
  })

  it("openSessionInLayout stacks same-label sessions as distinct tabs", () => {
    const workspace = makeWorkspace()
    const { tree, editorPanel } = YaadePanelTree.editorOnlyLayout()
    registerTerminalSession("yaade:terminal:cursor-1", "file:///tmp/p")
    workspace.registerTab({
      id: "yaade:terminal:cursor-1",
      kind: "terminal",
      label: "Cursor",
    })
    registerTerminalSession("yaade:terminal:cursor-2", "file:///tmp/p")
    workspace.registerTab({
      id: "yaade:terminal:cursor-2",
      kind: "terminal",
      label: "Cursor",
    })
    const first = openSessionInLayout(
      workspace,
      tree,
      "yaade:terminal:cursor-1",
      editorPanel,
    )
    const second = openSessionInLayout(
      workspace,
      tree,
      "yaade:terminal:cursor-2",
      first.panelId,
    )
    assert.equal(second.created, true)
    assert.equal(second.panelId.id, first.panelId.id)
    const view = tree.getView(second.panelId)
    assert.equal(view?.kind, "tabs")
    if (view?.kind === "tabs") {
      assert.deepEqual(panelTabIds(view).sort(), [
        "yaade:terminal:cursor-1",
        "yaade:terminal:cursor-2",
      ])
      assert.equal(view.activeTabId, "yaade:terminal:cursor-2")
    }
    clearTerminalSession("yaade:terminal:cursor-1")
    clearTerminalSession("yaade:terminal:cursor-2")
  })
})
