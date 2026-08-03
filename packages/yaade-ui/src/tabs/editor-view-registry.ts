import type { PanelId } from "@yaade/shared"

/** Opaque editor handle — avoids pulling monaco-editor into the startup graph. */
export type EditorViewHandle = {
  focus(): void
  layout?(): void
  getModel(): { getValue(): string; uri: { toString(): string } } | null
  getAction(id: string): { run(): void | Thenable<void> } | null
  getPosition(): { lineNumber: number; column: number } | null
  getSelections?(): unknown[] | null
  setPosition(position: { lineNumber: number; column: number }): void
  revealPositionInCenter?(position: { lineNumber: number; column: number }): void
  deltaDecorations?(
    oldDecorations: string[],
    newDecorations: unknown[],
  ): string[]
  setSelection?(selection: unknown): void
  onDidDispose?(listener: () => void): { dispose(): void }
}

const editorByPanel = new Map<number, EditorViewHandle>()
const destroyBufferHandlers = new Set<
  (panelId: PanelId, fileUri: string) => void
>()
const destroyPanelHandlers = new Set<(panelId: PanelId) => void>()

export function getEditorView(panelId: PanelId): EditorViewHandle | undefined {
  return editorByPanel.get(panelId.id)
}

export function getEditorCursor(panelId: PanelId): { line: number; column: number } | null {
  const editor = editorByPanel.get(panelId.id)
  if (!editor) return null
  const pos = editor.getPosition()
  if (!pos) return null
  return { line: pos.lineNumber, column: pos.column }
}

export function setEditorCursor(panelId: PanelId, line: number, column: number): void {
  const editor = editorByPanel.get(panelId.id)
  if (!editor) return
  editor.setPosition({ lineNumber: line, column })
  editor.revealPositionInCenter?.({ lineNumber: line, column })
}

export function registerEditorView(
  panelId: PanelId,
  view: EditorViewHandle | null,
): void {
  if (view) editorByPanel.set(panelId.id, view)
  else editorByPanel.delete(panelId.id)
}

export function onDestroyEditorBuffer(
  handler: (panelId: PanelId, fileUri: string) => void,
): () => void {
  destroyBufferHandlers.add(handler)
  return () => destroyBufferHandlers.delete(handler)
}

export function onDestroyEditorPanel(handler: (panelId: PanelId) => void): () => void {
  destroyPanelHandlers.add(handler)
  return () => destroyPanelHandlers.delete(handler)
}

export function destroyEditorBuffer(panelId: PanelId, fileUri: string): void {
  for (const handler of destroyBufferHandlers) handler(panelId, fileUri)
}

export function destroyEditorPanel(panelId: PanelId): void {
  for (const handler of destroyPanelHandlers) handler(panelId)
  editorByPanel.delete(panelId.id)
}
