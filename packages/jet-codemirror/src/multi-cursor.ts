import { EditorSelection, type EditorState } from "@codemirror/state"
import { EditorView, rectangularSelection } from "@codemirror/view"
import { SearchCursor } from "@codemirror/search"

/** Alt+click adds a cursor; Shift+Alt+drag enables column selection via rectangularSelection. */
export function multiCursorExtensions(): import("@codemirror/state").Extension[] {
  return [
    rectangularSelection(),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (!event.altKey || event.button !== 0 || event.shiftKey) return false
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
        if (pos == null) return false
        const ranges = view.state.selection.ranges
        const already = ranges.findIndex(r => r.from === pos && r.empty)
        const next =
          already >= 0
            ? EditorSelection.create(
                ranges.filter((_, i) => i !== already),
                Math.max(0, ranges.length - 2),
              )
            : EditorSelection.create([...ranges, EditorSelection.cursor(pos)], ranges.length)
        view.dispatch({ selection: next, scrollIntoView: true })
        event.preventDefault()
        return true
      },
    }),
  ]
}

function wordSelection(state: EditorState): EditorSelection {
  return EditorSelection.create(
    state.selection.ranges.map(
      range => state.wordAt(range.head) || EditorSelection.cursor(range.head),
    ),
    state.selection.mainIndex,
  )
}

function findNextMatch(
  state: EditorState,
  query: string,
  searchFrom: number,
  exclude: readonly { from: number; to: number }[],
): { from: number; to: number } | null {
  const main = state.selection.main
  const word = state.wordAt(main.head)
  const fullWord = word != null && word.from === main.from && word.to === main.to

  for (let cycled = false, cursor = new SearchCursor(state.doc, query, searchFrom); ; ) {
    if (!cursor.next().done) {
      const { from, to } = cursor.value
      if (exclude.some(r => r.from === from && r.to === to)) continue
      if (fullWord) {
        const atWord = state.wordAt(from)
        if (!atWord || atWord.from !== from || atWord.to !== to) continue
      }
      return { from, to }
    }
    if (cycled) return null
    cursor = new SearchCursor(state.doc, query, 0, Math.max(0, searchFrom - 1))
    cycled = true
  }
}

/**
 * Sublime-style Quick Skip Next: skip the current match when building a
 * multi-selection (Cmd+K Cmd+D).
 */
export function skipNextOccurrence(view: EditorView): boolean {
  const { state } = view
  const { ranges, mainIndex } = state.selection

  if (ranges.some(sel => sel.from === sel.to)) {
    const withWord = wordSelection(state)
    if (withWord.eq(state.selection)) return false
    const main = withWord.main
    if (main.from === main.to) return false
    const query = state.sliceDoc(main.from, main.to)
    const next = findNextMatch(state, query, main.to, [main])
    if (!next) return false
    view.dispatch({
      selection: EditorSelection.cursor(next.from),
      scrollIntoView: true,
    })
    return true
  }

  const searchedText = state.sliceDoc(ranges[0]!.from, ranges[0]!.to)
  if (ranges.some(r => state.sliceDoc(r.from, r.to) !== searchedText)) return false

  if (ranges.length > 1) {
    const remaining = ranges.filter((_, i) => i !== mainIndex)
    view.dispatch({
      selection: EditorSelection.create(remaining, Math.min(mainIndex, remaining.length - 1)),
      scrollIntoView: true,
    })
    return true
  }

  const main = ranges[mainIndex]!
  const next = findNextMatch(state, searchedText, main.to, [main])
  if (!next) return false
  view.dispatch({
    selection: EditorSelection.cursor(next.from),
    scrollIntoView: true,
  })
  return true
}
