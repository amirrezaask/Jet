import type { EditorView } from "@codemirror/view"
import { EditorSelection } from "@codemirror/state"
import {
  openSearchPanel,
  setSearchQuery,
  SearchQuery,
  getSearchQuery,
} from "@codemirror/search"

export function openReplaceSearchPanel(view: EditorView): void {
  const q = getSearchQuery(view.state)
  view.dispatch({
    effects: setSearchQuery.of(
      new SearchQuery({
        search: q.search,
        caseSensitive: q.caseSensitive,
        literal: q.literal,
        regexp: q.regexp,
        replace: q.replace,
        wholeWord: q.wholeWord,
      }),
    ),
  })
  openSearchPanel(view)
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
