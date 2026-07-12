import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { filterTreeRows } from "./filter-tree.js"
import { ListerTreeState } from "./tree-state.js"
import type { ListerDataSource, ListerNode } from "./types.js"

type N = { name: string }

function node(id: string, name: string, isBranch = false): ListerNode<N> {
  return { id, searchText: name, isBranch, data: { name } }
}

describe("filterTreeRows", () => {
  it("keeps matching leaves and their ancestors", () => {
    const rows = [
      { searchText: "src", depth: 0, expanded: true, isBranch: true, id: "src" },
      { searchText: "index.ts", depth: 1, expanded: false, isBranch: false, id: "idx" },
      { searchText: "other", depth: 0, expanded: false, isBranch: true, id: "other" },
    ]
    const out = filterTreeRows("index", rows)
    assert.deepEqual(
      out.map(r => r.id),
      ["src", "idx"],
    )
  })

  it("reveals all children under an expanded matching branch", () => {
    const rows = [
      { searchText: "src", depth: 0, expanded: true, isBranch: true, id: "src" },
      { searchText: "a.ts", depth: 1, expanded: false, isBranch: false, id: "a" },
      { searchText: "b.ts", depth: 1, expanded: false, isBranch: false, id: "b" },
    ]
    const out = filterTreeRows("src", rows)
    assert.deepEqual(
      out.map(r => r.id),
      ["src", "a", "b"],
    )
  })

  it("hides children when matching branch is collapsed", () => {
    const rows = [
      { searchText: "src", depth: 0, expanded: false, isBranch: true, id: "src" },
      // flatten would not include children when collapsed; simulate empty
    ]
    const out = filterTreeRows("src", rows)
    assert.deepEqual(
      out.map(r => r.id),
      ["src"],
    )
  })

  it("empty query keeps all rows in order", () => {
    const rows = [
      { searchText: "b", depth: 0, expanded: false, isBranch: false, id: "b" },
      { searchText: "a", depth: 0, expanded: false, isBranch: false, id: "a" },
    ]
    assert.deepEqual(
      filterTreeRows("", rows).map(r => r.id),
      ["b", "a"],
    )
  })
})

describe("ListerTreeState expand under filter", () => {
  it("toggle loads children then filterTreeRows shows them for matching parent", async () => {
    const children = [node("a", "a.ts"), node("b", "b.ts")]
    const source: ListerDataSource<N> = {
      getRoots: () => [node("src", "src", true)],
      getChildren: id => (id === "src" ? children : []),
    }
    const state = new ListerTreeState(source, [])
    assert.equal(state.flatten().length, 1)

    await state.toggle("src")
    const flat = state.flatten().map(e => ({
      searchText: e.node.searchText,
      depth: e.depth,
      expanded: e.expanded,
      isBranch: Boolean(e.node.isBranch),
      id: e.node.id,
    }))
    assert.equal(flat.length, 3)
    assert.ok(flat[0]!.expanded)

    const filtered = filterTreeRows("src", flat)
    assert.deepEqual(
      filtered.map(r => r.id),
      ["src", "a", "b"],
    )
  })
})
