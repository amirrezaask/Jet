import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { EditorState, EditorSelection } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { skipNextOccurrence } from "./multi-cursor.js"

function applySkip(state: EditorState): EditorState {
  let current = state
  const view = {
    get state() {
      return current
    },
    dispatch(spec: Parameters<EditorView["dispatch"]>[0]) {
      current = current.update(spec)
    },
  } as EditorView
  skipNextOccurrence(view)
  return current
}

describe("skipNextOccurrence", () => {
  it("moves past the current word when selection is empty", () => {
    const doc = "foo bar foo baz"
    const state = EditorState.create({ doc, selection: { anchor: 0 } })
    const next = applySkip(state)
    assert.equal(next.selection.ranges.length, 1)
    assert.equal(next.selection.main.head, 8)
  })

  it("advances a single range to the next match without keeping the old one", () => {
    const doc = "foo bar foo baz"
    const state = EditorState.create({
      doc,
      selection: EditorSelection.single(0, 3),
    })
    const next = applySkip(state)
    assert.equal(next.selection.main.head, 8)
    assert.equal(next.selection.main.empty, true)
  })

  it("removes the main range when multiple ranges are selected", () => {
    const doc = "foo bar foo baz foo"
    const state = EditorState.create({
      doc,
      extensions: EditorState.allowMultipleSelections.of(true),
      selection: EditorSelection.create(
        [EditorSelection.range(0, 3), EditorSelection.range(8, 11)],
        1,
      ),
    })
    const next = applySkip(state)
    assert.equal(next.selection.ranges.length, 1)
    assert.equal(next.selection.main.from, 0)
  })
})
