import type * as monaco from "monaco-editor/esm/vs/editor/editor.api.js"
import {
  consumePendingEditorNavigation,
  type PendingEditorNavigation,
} from "./pending-editor.js"

export {
  setPendingEditorNavigation,
  consumePendingEditorNavigation,
  setPendingInitialContent,
  consumePendingInitialContent,
  type PendingEditorNavigation,
} from "./pending-editor.js"

/** Reveal a 1-based line/column in a Monaco editor. */
export function revealPosition(
  editor: monaco.editor.IStandaloneCodeEditor,
  line: number,
  column: number,
): void {
  const model = editor.getModel()
  if (!model) return
  const lineCount = model.getLineCount()
  const safeLine = Math.max(1, Math.min(line, lineCount))
  const maxColumn = model.getLineMaxColumn(safeLine)
  const safeColumn = Math.max(1, Math.min(column, maxColumn))
  const position: monaco.IPosition = { lineNumber: safeLine, column: safeColumn }
  editor.setPosition(position)
  editor.revealPositionInCenter(position)
  editor.focus()
}

let highlightDecorationCounter = 0

/** Briefly highlight a range, then remove the decoration. */
export function highlightRangeTemporarily(
  editor: monaco.editor.IStandaloneCodeEditor,
  range: monaco.IRange,
  ms = 1500,
): () => void {
  const id = `gharargah-highlight-${++highlightDecorationCounter}`
  const decorationIds = editor.deltaDecorations(
    [],
    [
      {
        range,
        options: {
          inlineClassName: "gharargah-monaco-range-highlight",
          className: "gharargah-monaco-range-highlight",
          isWholeLine: false,
          overviewRuler: {
            color: "var(--gharargah-accent, #3b82f6)",
            position: 4,
          },
        },
      },
    ],
  )

  const timer = window.setTimeout(() => {
    editor.deltaDecorations(decorationIds, [])
  }, ms)

  return () => {
    window.clearTimeout(timer)
    editor.deltaDecorations(decorationIds, [])
  }
}

/** Apply pending navigation for a URI, if any. */
export function applyPendingNavigation(
  editor: monaco.editor.IStandaloneCodeEditor,
  uri: string,
): boolean {
  const nav = consumePendingEditorNavigation(uri)
  if (!nav) return false
  revealPosition(editor, nav.line, nav.column)
  if (nav.endLine != null && nav.endColumn != null) {
    const model = editor.getModel()
    if (model) {
      const selection: monaco.ISelection = {
        selectionStartLineNumber: nav.line,
        selectionStartColumn: nav.column,
        positionLineNumber: nav.endLine,
        positionColumn: nav.endColumn,
      }
      editor.setSelection(selection)
    }
  }
  return true
}

export type { PendingEditorNavigation as PendingEditorNavigationType }
