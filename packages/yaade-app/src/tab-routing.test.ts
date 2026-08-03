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

  it("openTerminalTab stacks same-label agents as distinct tabs", () => {
    const workspace = makeWorkspace()
    const { tree, editorPanel } = YaadePanelTree.editorOnlyLayout()
    const first = openTerminalTab(workspace, tree, editorPanel, {
      label: "Cursor",
      agentId: "cursor",
      agentTitle: "Cursor",
      cwdRootUri: "file:///tmp/p",
    })
    const second = openTerminalTab(workspace, tree, editorPanel, {
      label: "Cursor",
      agentId: "cursor",
      agentTitle: "Cursor",
      cwdRootUri: "file:///tmp/p",
    })
    assert.notEqual(first.tabId, second.tabId)
    const view = tree.getView(first.panelId)
    assert.equal(view?.kind, "tabs")
    if (view?.kind === "tabs") {
      assert.deepEqual(panelTabIds(view).sort(), [first.tabId, second.tabId].sort())
    }
    for (const session of listTerminalSessions()) {
      clearTerminalSession(session.tabId)
    }
  })
})
