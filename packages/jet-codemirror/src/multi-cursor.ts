import { EditorSelection } from "@codemirror/state"
import { EditorView, rectangularSelection } from "@codemirror/view"

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
