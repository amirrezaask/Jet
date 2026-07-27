import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js"

export type MonacoEditorHandle = monaco.editor.IStandaloneCodeEditor

let activeEditor: MonacoEditorHandle | null = null

export function getActiveMonacoEditor(): MonacoEditorHandle | null {
  return activeEditor
}

export function setActiveMonacoEditor(editor: MonacoEditorHandle | null): void {
  activeEditor = editor
}

export function getEditorContent(editor: MonacoEditorHandle): string {
  return editor.getModel()?.getValue() ?? ""
}

export function setEditorContent(editor: MonacoEditorHandle, content: string): void {
  const model = editor.getModel()
  if (!model) return
  if (model.getValue() === content) return
  const fullRange = model.getFullModelRange()
  editor.executeEdits("gharargah-set-content", [{ range: fullRange, text: content }])
}

export function getCursorPosition(editor: MonacoEditorHandle): { line: number; column: number } {
  const pos = editor.getPosition()
  if (!pos) return { line: 1, column: 1 }
  return { line: pos.lineNumber, column: pos.column }
}

export function setCursorPosition(
  editor: MonacoEditorHandle,
  line: number,
  column: number,
): void {
  const model = editor.getModel()
  if (!model) return
  const lineCount = model.getLineCount()
  const safeLine = Math.max(1, Math.min(line, lineCount))
  const maxColumn = model.getLineMaxColumn(safeLine)
  const safeColumn = Math.max(1, Math.min(column, maxColumn))
  editor.setPosition({ lineNumber: safeLine, column: safeColumn })
  editor.revealPositionInCenter({ lineNumber: safeLine, column: safeColumn })
}

export function focusEditor(editor: MonacoEditorHandle): void {
  editor.focus()
}

export function layoutEditor(editor: MonacoEditorHandle): void {
  editor.layout()
}

export function triggerFind(editor: MonacoEditorHandle, searchString?: string): void {
  editor.trigger("gharargah", "actions.find", searchString ?? null)
}

export function triggerReplace(editor: MonacoEditorHandle): void {
  editor.trigger("gharargah", "editor.action.startFindReplaceAction", null)
}

export function formatDocument(editor: MonacoEditorHandle): Promise<void> {
  return editor.getAction("editor.action.formatDocument")?.run() ?? Promise.resolve()
}

export function undoEditor(editor: MonacoEditorHandle): void {
  editor.trigger("gharargah", "undo", null)
}

export function redoEditor(editor: MonacoEditorHandle): void {
  editor.trigger("gharargah", "redo", null)
}

export function selectAll(editor: MonacoEditorHandle): void {
  editor.trigger("gharargah", "editor.action.selectAll", null)
}

export function getSelectedText(editor: MonacoEditorHandle): string {
  const model = editor.getModel()
  const selection = editor.getSelection()
  if (!model || !selection) return ""
  return model.getValueInRange(selection)
}

export function insertText(editor: MonacoEditorHandle, text: string): void {
  const selection = editor.getSelection()
  if (!selection) return
  editor.executeEdits("gharargah-insert", [{ range: selection, text }])
}

export function getEditorUri(editor: MonacoEditorHandle): string | undefined {
  return editor.getModel()?.uri.toString()
}

export function isEditorFocused(editor: MonacoEditorHandle): boolean {
  return editor.hasTextFocus()
}

export function getEditorSelectionRange(editor: MonacoEditorHandle): monaco.IRange | null {
  return editor.getSelection()
}

export function setEditorSelection(editor: MonacoEditorHandle, range: monaco.IRange): void {
  editor.setSelection(range)
  editor.revealRangeInCenter(range)
}
