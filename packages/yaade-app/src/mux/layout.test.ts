import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildTabsView, panelTabIds } from "@yaade/workspace"
import {
  emptyMuxTree,
  muxLeafKind,
  paneView,
  placeOrPushEditorTab,
  placePtyInTree,
} from "./layout.js"

describe("muxLeafKind — file editor tabs", () => {
  it("recognizes file uris as editor", () => {
    assert.equal(muxLeafKind("file:///tmp/a.ts"), "editor")
    assert.equal(muxLeafKind("untitled:1"), "editor")
    assert.equal(muxLeafKind("yaade:editor:pane-1"), "editor")
  })
})

describe("placeOrPushEditorTab", () => {
  it("pushes a second file into the focused editor pane", () => {
    const tree = emptyMuxTree()
    const term = placePtyInTree(tree, "yaade:terminal:s1", null)
    const editor = placeOrPushEditorTab(tree, "file:///a.ts", term)
    assert.notEqual(editor.id, term.id)
    const again = placeOrPushEditorTab(tree, "file:///b.ts", editor)
    assert.equal(again.id, editor.id)
    const view = tree.getView(editor)
    assert.ok(view && view.kind === "tabs")
    assert.deepEqual(panelTabIds(view).sort(), [
      "file:///a.ts",
      "file:///b.ts",
    ])
    assert.equal(view.activeTabId, "file:///b.ts")
  })

  it("activates an existing tab instead of duplicating", () => {
    const tree = emptyMuxTree()
    const editor = placeOrPushEditorTab(tree, "file:///a.ts", null)
    placeOrPushEditorTab(tree, "file:///b.ts", editor)
    placeOrPushEditorTab(tree, "file:///a.ts", editor)
    const view = tree.getView(editor)
    assert.ok(view && view.kind === "tabs")
    assert.equal(panelTabIds(view).length, 2)
    assert.equal(view.activeTabId, "file:///a.ts")
  })

  it("treats .. and encoded URI variants as the same file", () => {
    const tree = emptyMuxTree()
    const editor = placeOrPushEditorTab(
      tree,
      "file:///Users/proj/src/foo.ts",
      null,
    )
    const again = placeOrPushEditorTab(
      tree,
      "file:///Users/proj/src/../src/foo.ts",
      editor,
    )
    assert.equal(again.id, editor.id)
    const view = tree.getView(editor)
    assert.ok(view && view.kind === "tabs")
    assert.equal(panelTabIds(view).length, 1)
    assert.equal(view.activeTabId, "file:///Users/proj/src/foo.ts")
  })

  it("forceNewGroup always splits a new editor pane", () => {
    const tree = emptyMuxTree()
    const first = placeOrPushEditorTab(tree, "file:///a.ts", null)
    const second = placeOrPushEditorTab(tree, "file:///b.ts", first, "right", {
      forceNewGroup: true,
    })
    assert.notEqual(second.id, first.id)
    assert.deepEqual(panelTabIds(tree.getView(first)!), ["file:///a.ts"])
    assert.deepEqual(panelTabIds(tree.getView(second)!), ["file:///b.ts"])
  })

  it("paneView still builds a single-tab view", () => {
    const view = paneView("file:///x.ts")
    assert.deepEqual(view, buildTabsView("file:///x.ts", ["file:///x.ts"]))
  })
})

describe("YaadePanelTree smoke", () => {
  it("findEditorPanelForFile sees file tabs", () => {
    const tree = emptyMuxTree()
    const panel = placeOrPushEditorTab(tree, "file:///z.ts", null)
    assert.equal(tree.findEditorPanelForFile("file:///z.ts")?.id, panel.id)
  })
})
