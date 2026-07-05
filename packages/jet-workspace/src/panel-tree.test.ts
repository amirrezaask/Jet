import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { JetPanelTree } from "./panel-tree.js"
import { buildEditorView } from "./panel-buffers.js"

describe("JetPanelTree — layouts", () => {
  it("editorOnlyLayout yields one editor-slot leaf", () => {
    const { tree, editorPanel } = JetPanelTree.editorOnlyLayout()
    assert.equal(tree.getView(editorPanel)?.kind, "empty")
    assert.equal(tree.root.kind, "leaf")
  })

  it("workspaceLayout splits sidebar+editor left/right", () => {
    const { tree, sidebarPanel, editorPanel } = JetPanelTree.workspaceLayout()
    assert.notEqual(sidebarPanel.id, editorPanel.id)
    assert.equal(tree.root.kind, "row")
    if (tree.root.kind === "row") {
      const [first, second] = tree.root.split.children
      assert.equal(first?.kind, "leaf")
      assert.equal(second?.kind, "leaf")
      if (first?.kind === "leaf") assert.equal(first.panelId.id, sidebarPanel.id)
      if (second?.kind === "leaf") assert.equal(second.panelId.id, editorPanel.id)
    }
  })
})

describe("JetPanelTree — findEditorPanelForFile", () => {
  it("matches active fileUri", () => {
    const { tree, editorPanel } = JetPanelTree.editorOnlyLayout()
    tree.setView(editorPanel, buildEditorView("file:///a.ts", ["file:///a.ts"]))
    assert.equal(tree.findEditorPanelForFile("file:///a.ts")?.id, editorPanel.id)
  })

  it("matches inactive buffer inside stack", () => {
    const { tree, editorPanel } = JetPanelTree.editorOnlyLayout()
    tree.setView(editorPanel, buildEditorView("file:///b.ts", ["file:///b.ts", "file:///a.ts"]))
    assert.equal(tree.findEditorPanelForFile("file:///a.ts")?.id, editorPanel.id)
  })

  it("returns null when uri not present", () => {
    const { tree, editorPanel } = JetPanelTree.editorOnlyLayout()
    tree.setView(editorPanel, buildEditorView("file:///a.ts", ["file:///a.ts"]))
    assert.equal(tree.findEditorPanelForFile("file:///missing.ts"), null)
  })

  it("finds panel across splits", () => {
    const { tree, editorPanel } = JetPanelTree.editorOnlyLayout()
    const right = tree.splitAtEdge(editorPanel, "right")
    tree.setView(right, buildEditorView("file:///z.ts", ["file:///z.ts"]))
    assert.equal(tree.findEditorPanelForFile("file:///z.ts")?.id, right.id)
  })
})

describe("JetPanelTree — normalizeEditorViews (legacy snapshot)", () => {
  it("populates buffers[] when missing", () => {
    const { tree, editorPanel } = JetPanelTree.editorOnlyLayout()
    tree.setView(editorPanel, { kind: "editor", fileUri: "file:///a.ts" })
    tree.normalizeEditorViews()
    const view = tree.getView(editorPanel)
    if (view?.kind !== "editor") throw new Error("expected editor")
    assert.deepEqual(view.buffers, ["file:///a.ts"])
  })

  it("keeps existing buffers[]", () => {
    const { tree, editorPanel } = JetPanelTree.editorOnlyLayout()
    tree.setView(editorPanel, buildEditorView("file:///a.ts", ["file:///a.ts", "file:///b.ts"]))
    tree.normalizeEditorViews()
    const view = tree.getView(editorPanel)
    if (view?.kind !== "editor") throw new Error("expected editor")
    assert.deepEqual(view.buffers, ["file:///a.ts", "file:///b.ts"])
  })
})

describe("JetPanelTree — applyDrop", () => {
  it("moveToPane overwrites target and closes source", () => {
    const { tree, editorPanel } = JetPanelTree.editorOnlyLayout()
    const right = tree.splitAtEdge(editorPanel, "right")
    tree.setView(editorPanel, buildEditorView("file:///a.ts", ["file:///a.ts"]))
    tree.setView(right, { kind: "explorer" })
    const ok = tree.applyDrop(editorPanel, right, { kind: "moveToPane" })
    assert.equal(ok, true)
    assert.equal(tree.getView(right)?.kind, "editor")
    assert.equal(tree.root.kind, "leaf") // collapsed after source close
  })

  it("split edge creates new leaf carrying source view", () => {
    const { tree, sidebarPanel, editorPanel } = JetPanelTree.workspaceLayout()
    tree.setView(sidebarPanel, { kind: "explorer" })
    tree.setView(editorPanel, buildEditorView("file:///a.ts", ["file:///a.ts"]))
    // Add a second editor panel to drop
    const second = tree.splitAtEdge(editorPanel, "right")
    tree.setView(second, buildEditorView("file:///b.ts", ["file:///b.ts"]))
    const before = tree.findEditorPanelForFile("file:///b.ts")
    assert.ok(before)
    const ok = tree.applyDrop(second, editorPanel, { kind: "split", edge: "bottom" })
    assert.equal(ok, true)
    const after = tree.findEditorPanelForFile("file:///b.ts")
    assert.ok(after)
    assert.notEqual(after!.id, before!.id) // moved to new leaf
    // Source panel is gone after close
    assert.equal(tree.getView(second), null)
  })

  it("source === target is no-op", () => {
    const { tree, editorPanel } = JetPanelTree.editorOnlyLayout()
    const ok = tree.applyDrop(editorPanel, editorPanel, { kind: "moveToPane" })
    assert.equal(ok, false)
  })

  it("missing target returns false", () => {
    const { tree, editorPanel } = JetPanelTree.editorOnlyLayout()
    const ok = tree.applyDrop(editorPanel, { id: 999 }, { kind: "moveToPane" })
    assert.equal(ok, false)
  })
})

describe("JetPanelTree — jetFromJSON", () => {
  it("restores structure and normalizes legacy editor views", () => {
    const { tree, editorPanel } = JetPanelTree.editorOnlyLayout()
    tree.setView(editorPanel, { kind: "editor", fileUri: "file:///a.ts" })
    const restored = JetPanelTree.jetFromJSON(tree.toJSON())
    const view = restored.getView(editorPanel)
    if (view?.kind !== "editor") throw new Error("expected editor")
    assert.deepEqual(view.buffers, ["file:///a.ts"])
    assert.equal(restored.findEditorPanelForFile("file:///a.ts")?.id, editorPanel.id)
  })
})
