import type { PanelId, PanelView } from "@jet/shared"
import type { PanelTree } from "@jet/panels"

export type EditorPanelView = Extract<PanelView, { kind: "editor" }>

export function editorBuffers(view: EditorPanelView): string[] {
  return view.buffers ?? [view.fileUri]
}

export function normalizeEditorView(view: PanelView): PanelView {
  if (view.kind !== "editor") return view
  const buffers = view.buffers?.length ? view.buffers : [view.fileUri]
  if (buffers[0] === view.fileUri && view.buffers) return view
  return { kind: "editor", fileUri: view.fileUri, buffers }
}

export function panelHasBuffer(view: PanelView | null, uri: string): boolean {
  if (!view || view.kind !== "editor") return false
  return editorBuffers(view).includes(uri)
}

export function buildEditorView(activeUri: string, buffers: string[]): EditorPanelView {
  const unique = [activeUri, ...buffers.filter(u => u !== activeUri)]
  return { kind: "editor", fileUri: activeUri, buffers: unique }
}

export function pushPanelBufferView(
  current: PanelView | null,
  uri: string,
  replaceUri?: string,
): EditorPanelView {
  if (current?.kind === "editor") {
    let existing = editorBuffers(current)
    if (replaceUri) existing = existing.map(u => (u === replaceUri ? uri : u))
    return buildEditorView(uri, existing)
  }
  return { kind: "editor", fileUri: uri, buffers: [uri] }
}

export function popPanelBufferView(current: EditorPanelView, uri: string): PanelView {
  const buffers = editorBuffers(current).filter(u => u !== uri)
  if (buffers.length === 0) return { kind: "empty" }
  return buildEditorView(buffers[0]!, buffers)
}

export function findPanelWithBuffer(tree: PanelTree, uri: string): PanelId | null {
  return tree.findPanelWithView(v => panelHasBuffer(v, uri))
}
