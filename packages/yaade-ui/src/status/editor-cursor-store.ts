export type EditorCursorPos = { line: number; column: number; rangeCount?: number }

type Listener = () => void

let cursor: EditorCursorPos | null = null
const listeners = new Set<Listener>()

export function setEditorCursor(pos: EditorCursorPos | null): void {
  if (
    cursor?.line === pos?.line &&
    cursor?.column === pos?.column &&
    cursor?.rangeCount === pos?.rangeCount
  )
    return
  cursor = pos
  for (const listener of listeners) listener()
}

export function getEditorCursor(): EditorCursorPos | null {
  return cursor
}

export function subscribeEditorCursor(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
