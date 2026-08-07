import type * as monaco from "monaco-editor/esm/vs/editor/editor.api.js"
import { monacoModels, type MonacoModelDiagnostic } from "./model-registry.js"

export type MonacoMountedEditorDiagnostic = {
  id: string
  uri: string
  focused: boolean
  position: { line: number; column: number } | null
  selections: Array<{
    startLine: number
    startColumn: number
    endLine: number
    endColumn: number
  }>
  scrollTop: number
  scrollLeft: number
}

export type MonacoLifecycleDiagnostics = {
  mounts: number
  disposals: number
  modelAttaches: number
  modelDetaches: number
}

export type MonacoEditorDiagnostics = {
  models: MonacoModelDiagnostic[]
  editors: MonacoMountedEditorDiagnostic[]
  activeUri: string | null
  lifecycle: MonacoLifecycleDiagnostics
}

type MutableMountedEditor = {
  uri: string
  focused: boolean
  editor: monaco.editor.IStandaloneCodeEditor
}

const mountedEditors = new Map<string, MutableMountedEditor>()
const lifecycle: MonacoLifecycleDiagnostics = {
  mounts: 0,
  disposals: 0,
  modelAttaches: 0,
  modelDetaches: 0,
}

export function recordMonacoEditorMounted(
  editorId: string,
  uri: string,
  editor: monaco.editor.IStandaloneCodeEditor,
): void {
  lifecycle.mounts++
  lifecycle.modelAttaches++
  mountedEditors.set(editorId, {
    uri: monacoModels.canonicalKey(uri),
    focused: false,
    editor,
  })
}

export function recordMonacoEditorModelChanged(editorId: string, uri: string): void {
  const editor = mountedEditors.get(editorId)
  if (!editor) return
  const nextUri = monacoModels.canonicalKey(uri)
  if (editor.uri === nextUri) return
  lifecycle.modelDetaches++
  lifecycle.modelAttaches++
  editor.uri = nextUri
}

export function recordMonacoEditorFocused(editorId: string): void {
  for (const [id, editor] of mountedEditors) editor.focused = id === editorId
}

export function recordMonacoEditorBlurred(editorId: string): void {
  const editor = mountedEditors.get(editorId)
  if (editor) editor.focused = false
}

export function recordMonacoEditorDisposed(editorId: string): void {
  if (!mountedEditors.delete(editorId)) return
  lifecycle.disposals++
  lifecycle.modelDetaches++
}

export function getMonacoEditorDiagnostics(): MonacoEditorDiagnostics {
  const editors = [...mountedEditors.entries()]
    .map(([id, item]) => {
      const position = item.editor.getPosition()
      return {
        id,
        uri: item.uri,
        focused: item.focused,
        position: position
          ? { line: position.lineNumber, column: position.column }
          : null,
        selections: item.editor.getSelections()?.map(selection => ({
          startLine: selection.startLineNumber,
          startColumn: selection.startColumn,
          endLine: selection.endLineNumber,
          endColumn: selection.endColumn,
        })) ?? [],
        scrollTop: item.editor.getScrollTop(),
        scrollLeft: item.editor.getScrollLeft(),
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
  return {
    models: monacoModels.diagnostics(),
    editors,
    activeUri: editors.find(editor => editor.focused)?.uri ?? null,
    lifecycle: { ...lifecycle },
  }
}
