import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  YaadePanelTree,
  WorkspaceService,
  WorkspaceManager,
  panelTabIds,
} from "@yaade/workspace"
import {
  allocTerminalSessionKey,
  openTerminalTab,
} from "./tab-routing.js"
import { clearTerminalSession, listTerminalSessions } from "./tabs/terminal-session.js"

function makeWorkspace() {
  return new WorkspaceService(new WorkspaceManager())
}

describe("tab-routing", () => {
  it("allocTerminalSessionKey never repeats in a burst", () => {
    const keys = new Set<string>()
    for (let i = 0; i < 200; i++) keys.add(allocTerminalSessionKey())
    assert.equal(keys.size, 200)
  })

  it("openTerminalTab splits same-label agents into distinct panes", () => {
    const workspace = makeWorkspace()
    const { tree, editorPanel } = YaadePanelTree.editorOnlyLayout()
    const first = openTerminalTab(workspace, tree, editorPanel, {
      label: "Cursor",
      agentId: "cursor",
      agentTitle: "Cursor",
      cwdRootUri: "file:///tmp/p",
    })
    const second = openTerminalTab(workspace, tree, first.panelId, {
      label: "Cursor",
      agentId: "cursor",
      agentTitle: "Cursor",
      cwdRootUri: "file:///tmp/p",
    })
    assert.notEqual(first.tabId, second.tabId)
    assert.notEqual(first.panelId.id, second.panelId.id)
    const firstView = tree.getView(first.panelId)
    const secondView = tree.getView(second.panelId)
    assert.equal(firstView?.kind, "tabs")
    assert.equal(secondView?.kind, "tabs")
    if (firstView?.kind === "tabs") {
      assert.deepEqual(panelTabIds(firstView), [first.tabId])
    }
    if (secondView?.kind === "tabs") {
      assert.deepEqual(panelTabIds(secondView), [second.tabId])
    }
    assert.equal(tree.root.kind, "row")
    for (const session of listTerminalSessions()) {
      clearTerminalSession(session.tabId)
    }
  })
})
