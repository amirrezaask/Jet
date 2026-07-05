import type { EditorView } from "@codemirror/view"
import { EditorSelection } from "@codemirror/state"
import { openJetSearch } from "./search-bridge.js"

export function openReplaceSearchPanel(view: EditorView): void {
  openJetSearch(view, "replace")
}

export function jumpToLine(view: EditorView, line: number, column = 1): void {
  const doc = view.state.doc
  const lineNum = Math.max(1, Math.min(line, doc.lines))
  const lineObj = doc.line(lineNum)
  const col = Math.max(1, Math.min(column, lineObj.length + 1))
  const pos = lineObj.from + col - 1
  view.dispatch({
    selection: EditorSelection.cursor(pos),
    scrollIntoView: true,
  })
  view.focus()
}
