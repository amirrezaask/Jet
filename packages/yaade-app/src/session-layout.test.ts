import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { YaadePanelTree, WorkspaceService, WorkspaceManager } from "@yaade/workspace"
import { registerTerminalSession, clearTerminalSession } from "./tabs/terminal-session.js"
import {
  applySessionPaneDrop,
  hideSessionFromLayout,
  openSessionInLayout,
  placeSessionFromOutside,
  terminalOnlyView,
} from "./session-layout.js"
import { findPanelWithTab, panelTabIds, buildTabsView } from "@yaade/workspace"

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

  it("openSessionInLayout splits when focused pane already has a session", () => {
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
    assert.notEqual(second.panelId.id, first.panelId.id)
    const firstView = tree.getView(first.panelId)
    const secondView = tree.getView(second.panelId)
    assert.equal(firstView?.kind, "tabs")
    assert.equal(secondView?.kind, "tabs")
    if (firstView?.kind === "tabs") {
      assert.deepEqual(panelTabIds(firstView), ["yaade:terminal:cursor-1"])
    }
    if (secondView?.kind === "tabs") {
      assert.deepEqual(panelTabIds(secondView), ["yaade:terminal:cursor-2"])
    }
    assert.equal(tree.root.kind, "row")
    clearTerminalSession("yaade:terminal:cursor-1")
    clearTerminalSession("yaade:terminal:cursor-2")
  })

  it("applySessionPaneDrop swaps on center move", () => {
    const workspace = makeWorkspace()
    const { tree, editorPanel } = YaadePanelTree.editorOnlyLayout()
    registerTerminalSession("yaade:terminal:left", "file:///tmp/a")
    workspace.registerTab({
      id: "yaade:terminal:left",
      kind: "terminal",
      label: "Left",
    })
    registerTerminalSession("yaade:terminal:right", "file:///tmp/b")
    workspace.registerTab({
      id: "yaade:terminal:right",
      kind: "terminal",
      label: "Right",
    })
    const left = openSessionInLayout(
      workspace,
      tree,
      "yaade:terminal:left",
      editorPanel,
    )
    const right = openSessionInLayout(
      workspace,
      tree,
      "yaade:terminal:right",
      left.panelId,
    )
    const result = applySessionPaneDrop(
      tree,
      left.panelId,
      "yaade:terminal:left",
      right.panelId,
      { kind: "moveToPane" },
    )
    assert.equal(result.moved, true)
    assert.equal(result.focusPanel.id, right.panelId.id)
    const leftView = tree.getView(left.panelId)
    const rightView = tree.getView(right.panelId)
    assert.equal(leftView?.kind, "tabs")
    assert.equal(rightView?.kind, "tabs")
    if (leftView?.kind === "tabs") {
      assert.equal(leftView.activeTabId, "yaade:terminal:right")
    }
    if (rightView?.kind === "tabs") {
      assert.equal(rightView.activeTabId, "yaade:terminal:left")
    }
    clearTerminalSession("yaade:terminal:left")
    clearTerminalSession("yaade:terminal:right")
  })

  it("placeSessionFromOutside replaces target on center drop", () => {
    const workspace = makeWorkspace()
    const { tree, editorPanel } = YaadePanelTree.editorOnlyLayout()
    registerTerminalSession("yaade:terminal:old", "file:///tmp/a")
    workspace.registerTab({
      id: "yaade:terminal:old",
      kind: "terminal",
      label: "Old",
    })
    registerTerminalSession("yaade:terminal:new", "file:///tmp/b")
    workspace.registerTab({
      id: "yaade:terminal:new",
      kind: "terminal",
      label: "New",
    })
    const opened = openSessionInLayout(
      workspace,
      tree,
      "yaade:terminal:old",
      editorPanel,
    )
    const placed = placeSessionFromOutside(
      workspace,
      tree,
      "yaade:terminal:new",
      opened.panelId,
      { kind: "moveToPane" },
    )
    assert.equal(placed.panelId.id, opened.panelId.id)
    const view = tree.getView(opened.panelId)
    assert.equal(view?.kind, "tabs")
    if (view?.kind === "tabs") {
      assert.deepEqual(panelTabIds(view), ["yaade:terminal:new"])
    }
    assert.equal(findPanelWithTab(tree, "yaade:terminal:old"), null)
    clearTerminalSession("yaade:terminal:old")
    clearTerminalSession("yaade:terminal:new")
  })

  it("applySessionPaneDrop moves git panes on edge split", () => {
    const { tree, editorPanel } = YaadePanelTree.editorOnlyLayout()
    const termId = "yaade:terminal:term"
    const gitId = "yaade:git:pane-1"
    tree.setView(editorPanel, buildTabsView(termId, [termId]))
    const right = tree.splitAtEdge(editorPanel, "right")
    tree.setView(right, buildTabsView(gitId, [gitId]))

    const result = applySessionPaneDrop(
      tree,
      right,
      gitId,
      editorPanel,
      { kind: "split", edge: "bottom" },
    )
    assert.equal(result.moved, true)
    assert.ok(result.createdPanel)
    assert.equal(findPanelWithTab(tree, gitId)?.id, result.createdPanel!.id)
    assert.equal(findPanelWithTab(tree, termId)?.id, editorPanel.id)
    assert.notEqual(result.createdPanel!.id, right.id)
  })

  it("applySessionPaneDrop swaps git with terminal on center move", () => {
    const { tree, editorPanel } = YaadePanelTree.editorOnlyLayout()
    const termId = "yaade:terminal:term"
    const gitId = "yaade:git:pane-2"
    tree.setView(editorPanel, buildTabsView(termId, [termId]))
    const right = tree.splitAtEdge(editorPanel, "right")
    tree.setView(right, buildTabsView(gitId, [gitId]))

    const result = applySessionPaneDrop(
      tree,
      right,
      gitId,
      editorPanel,
      { kind: "moveToPane" },
    )
    assert.equal(result.moved, true)
    const leftView = tree.getView(editorPanel)
    const rightView = tree.getView(right)
    assert.equal(leftView?.kind, "tabs")
    assert.equal(rightView?.kind, "tabs")
    if (leftView?.kind === "tabs") assert.equal(leftView.activeTabId, gitId)
    if (rightView?.kind === "tabs") assert.equal(rightView.activeTabId, termId)
  })
})
