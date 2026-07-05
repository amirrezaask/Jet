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

describe("JetPanelTree — applyTabDrop", () => {
  it("moveToPane merges buffer into target stack, focuses it, removes from source", () => {
    const { tree, editorPanel } = JetPanelTree.editorOnlyLayout()
    const right = tree.splitAtEdge(editorPanel, "right")
    tree.setView(editorPanel, buildEditorView("file:///a.ts", ["file:///a.ts", "file:///b.ts"]))
    tree.setView(right, buildEditorView("file:///c.ts", ["file:///c.ts"]))

    const res = tree.applyTabDrop(editorPanel, "file:///b.ts", right, { kind: "moveToPane" })
    assert.equal(res.moved, true)
    assert.equal(res.createdPanel, null)

    const src = tree.getView(editorPanel)
    if (src?.kind !== "editor") throw new Error("expected source editor")
    assert.deepEqual(src.buffers, ["file:///a.ts"])
    assert.equal(src.fileUri, "file:///a.ts")

    const tgt = tree.getView(right)
    if (tgt?.kind !== "editor") throw new Error("expected target editor")
    assert.deepEqual(tgt.buffers, ["file:///c.ts", "file:///b.ts"])
    assert.equal(tgt.fileUri, "file:///b.ts")
  })

  it("moveToPane with insertIndex splices at tab-bar position", () => {
    const { tree, editorPanel } = JetPanelTree.editorOnlyLayout()
    const right = tree.splitAtEdge(editorPanel, "right")
    tree.setView(editorPanel, buildEditorView("file:///a.ts", ["file:///a.ts", "file:///b.ts"]))
    tree.setView(
      right,
      buildEditorView("file:///c.ts", ["file:///c.ts", "file:///d.ts", "file:///e.ts"]),
    )

    const res = tree.applyTabDrop(editorPanel, "file:///b.ts", right, {
      kind: "moveToPane",
      insertIndex: 1,
    })
    assert.equal(res.moved, true)
    const tgt = tree.getView(right)
    if (tgt?.kind !== "editor") throw new Error("expected target editor")
    assert.deepEqual(tgt.buffers, ["file:///c.ts", "file:///b.ts", "file:///d.ts", "file:///e.ts"])
    assert.equal(tgt.fileUri, "file:///b.ts")
  })

  it("moveToPane onto empty target promotes target to editor view", () => {
    const { tree, editorPanel } = JetPanelTree.editorOnlyLayout()
    const right = tree.splitAtEdge(editorPanel, "right")
    tree.setView(editorPanel, buildEditorView("file:///a.ts", ["file:///a.ts", "file:///b.ts"]))
    // right stays empty

    const res = tree.applyTabDrop(editorPanel, "file:///b.ts", right, { kind: "moveToPane" })
    assert.equal(res.moved, true)
    const tgt = tree.getView(right)
    if (tgt?.kind !== "editor") throw new Error("expected target editor")
    assert.deepEqual(tgt.buffers, ["file:///b.ts"])
  })

  it("moveToPane onto same panel is no-op", () => {
    const { tree, editorPanel } = JetPanelTree.editorOnlyLayout()
    tree.setView(editorPanel, buildEditorView("file:///a.ts", ["file:///a.ts", "file:///b.ts"]))
    const res = tree.applyTabDrop(editorPanel, "file:///b.ts", editorPanel, { kind: "moveToPane" })
    assert.equal(res.moved, false)
    const v = tree.getView(editorPanel)
    if (v?.kind !== "editor") throw new Error("expected editor")
    assert.deepEqual(v.buffers, ["file:///a.ts", "file:///b.ts"])
  })

  it("split(edge) pops buffer into new pane on that edge of target", () => {
    const { tree, editorPanel } = JetPanelTree.editorOnlyLayout()
    tree.setView(editorPanel, buildEditorView("file:///a.ts", ["file:///a.ts", "file:///b.ts"]))
    const res = tree.applyTabDrop(editorPanel, "file:///b.ts", editorPanel, {
      kind: "split",
      edge: "right",
    })
    assert.equal(res.moved, true)
    assert.ok(res.createdPanel)
    // Now root should be a row split with two leaves.
    assert.equal(tree.root.kind, "row")
    // Source panel keeps only a.ts
    const src = tree.getView(editorPanel)
    if (src?.kind !== "editor") throw new Error("expected source editor")
    assert.deepEqual(src.buffers, ["file:///a.ts"])
    // Created panel holds only b.ts
    const created = tree.getView(res.createdPanel!)
    if (created?.kind !== "editor") throw new Error("expected created editor")
    assert.deepEqual(created.buffers, ["file:///b.ts"])
  })

  it("split from other-panel drop creates new leaf next to target", () => {
    const { tree, editorPanel } = JetPanelTree.editorOnlyLayout()
    const right = tree.splitAtEdge(editorPanel, "right")
    tree.setView(editorPanel, buildEditorView("file:///a.ts", ["file:///a.ts", "file:///b.ts"]))
    tree.setView(right, buildEditorView("file:///c.ts", ["file:///c.ts"]))

    const res = tree.applyTabDrop(editorPanel, "file:///b.ts", right, {
      kind: "split",
      edge: "bottom",
    })
    assert.equal(res.moved, true)
    assert.ok(res.createdPanel)
    const created = tree.getView(res.createdPanel!)
    if (created?.kind !== "editor") throw new Error("expected created editor")
    assert.deepEqual(created.buffers, ["file:///b.ts"])
    // Source lost b.ts
    const src = tree.getView(editorPanel)
    if (src?.kind !== "editor") throw new Error("expected src editor")
    assert.deepEqual(src.buffers, ["file:///a.ts"])
  })

  it("moving last buffer collapses source to empty then prunes", () => {
    const { tree, editorPanel } = JetPanelTree.editorOnlyLayout()
    const right = tree.splitAtEdge(editorPanel, "right")
    tree.setView(editorPanel, buildEditorView("file:///a.ts", ["file:///a.ts"]))
    tree.setView(right, buildEditorView("file:///c.ts", ["file:///c.ts"]))

    const res = tree.applyTabDrop(editorPanel, "file:///a.ts", right, { kind: "moveToPane" })
    assert.equal(res.moved, true)
    // Source panel emptied → pruneEmptyLeaves collapses split; root becomes leaf.
    assert.equal(tree.root.kind, "leaf")
    if (tree.root.kind === "leaf") {
      assert.equal(tree.root.panelId.id, right.id)
    }
    const tgt = tree.getView(right)
    if (tgt?.kind !== "editor") throw new Error("expected target editor")
    assert.deepEqual(tgt.buffers, ["file:///c.ts", "file:///a.ts"])
    assert.equal(tgt.fileUri, "file:///a.ts")
  })

  it("missing sourceUri returns moved=false with no state change", () => {
    const { tree, editorPanel } = JetPanelTree.editorOnlyLayout()
    const right = tree.splitAtEdge(editorPanel, "right")
    tree.setView(editorPanel, buildEditorView("file:///a.ts", ["file:///a.ts"]))
    tree.setView(right, buildEditorView("file:///c.ts", ["file:///c.ts"]))

    const res = tree.applyTabDrop(editorPanel, "file:///missing.ts", right, { kind: "moveToPane" })
    assert.equal(res.moved, false)
    const src = tree.getView(editorPanel)
    if (src?.kind !== "editor") throw new Error("expected editor")
    assert.deepEqual(src.buffers, ["file:///a.ts"])
  })

  it("non-editor source moves whole view, source becomes empty then prunes", () => {
    const { tree, editorPanel } = JetPanelTree.editorOnlyLayout()
    const right = tree.splitAtEdge(editorPanel, "right")
    tree.setView(editorPanel, { kind: "explorer" })
    tree.setView(right, buildEditorView("file:///c.ts", ["file:///c.ts"]))
    const res = tree.applyTabDrop(editorPanel, "explorer", right, {
      kind: "split",
      edge: "left",
    })
    assert.equal(res.moved, true)
    assert.ok(res.createdPanel)
    const created = tree.getView(res.createdPanel!)
    assert.equal(created?.kind, "explorer")
  })

  it("non-editor source moveToPane replaces target view", () => {
    const { tree, editorPanel } = JetPanelTree.editorOnlyLayout()
    const right = tree.splitAtEdge(editorPanel, "right")
    tree.setView(editorPanel, { kind: "explorer" })
    tree.setView(right, buildEditorView("file:///c.ts", ["file:///c.ts"]))
    const res = tree.applyTabDrop(editorPanel, "explorer", right, { kind: "moveToPane" })
    assert.equal(res.moved, true)
    const tgt = tree.getView(right)
    assert.equal(tgt?.kind, "explorer")
    // Source emptied then pruned; tree collapses to single leaf.
    assert.equal(tree.root.kind, "leaf")
  })

  it("split(edge=left) creates new leaf on left side", () => {
    const { tree, editorPanel } = JetPanelTree.editorOnlyLayout()
    tree.setView(editorPanel, buildEditorView("file:///a.ts", ["file:///a.ts", "file:///b.ts"]))
    const res = tree.applyTabDrop(editorPanel, "file:///b.ts", editorPanel, {
      kind: "split",
      edge: "left",
    })
    assert.equal(res.moved, true)
    assert.equal(tree.root.kind, "row")
    if (tree.root.kind === "row") {
      const [first, second] = tree.root.split.children
      // New leaf (b.ts) inserted on left = index 0.
      if (first?.kind === "leaf") assert.equal(first.panelId.id, res.createdPanel!.id)
      if (second?.kind === "leaf") assert.equal(second.panelId.id, editorPanel.id)
    }
  })

  it("split(edge=top) creates column split with new leaf on top", () => {
    const { tree, editorPanel } = JetPanelTree.editorOnlyLayout()
    tree.setView(editorPanel, buildEditorView("file:///a.ts", ["file:///a.ts", "file:///b.ts"]))
    const res = tree.applyTabDrop(editorPanel, "file:///b.ts", editorPanel, {
      kind: "split",
      edge: "top",
    })
    assert.equal(res.moved, true)
    assert.equal(tree.root.kind, "column")
    if (tree.root.kind === "column") {
      const [first] = tree.root.split.children
      if (first?.kind === "leaf") assert.equal(first.panelId.id, res.createdPanel!.id)
    }
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
