type SerializedEditorViewState = Record<string, unknown>

const statesBySession = new Map<string, Map<string, SerializedEditorViewState>>()

export function editorViewStateKey(viewStateId: string, uri: string): string {
  return `${viewStateId}\0${uri}`
}

export function getEditorViewState(
  sessionId: string,
  viewStateId: string,
  uri: string,
): SerializedEditorViewState | null {
  return statesBySession.get(sessionId)?.get(editorViewStateKey(viewStateId, uri)) ?? null
}

export function setEditorViewState(
  sessionId: string,
  viewStateId: string,
  uri: string,
  state: unknown,
): void {
  if (!state || typeof state !== "object") return
  let session = statesBySession.get(sessionId)
  if (!session) {
    session = new Map()
    statesBySession.set(sessionId, session)
  }
  session.set(editorViewStateKey(viewStateId, uri), state as SerializedEditorViewState)
}

export function replaceEditorViewStates(
  sessionId: string,
  states: Readonly<Record<string, unknown>> | null | undefined,
): void {
  const next = new Map<string, SerializedEditorViewState>()
  for (const [key, state] of Object.entries(states ?? {})) {
    if (!key || !state || typeof state !== "object") continue
    next.set(key, state as SerializedEditorViewState)
  }
  statesBySession.set(sessionId, next)
}

export function snapshotEditorViewStates(
  sessionId: string,
): Record<string, SerializedEditorViewState> {
  return Object.fromEntries(statesBySession.get(sessionId) ?? [])
}

/** Move every per-pane view state when Save As promotes a buffer URI. */
export function remapEditorViewStateUri(
  sessionId: string,
  oldUri: string,
  newUri: string,
): void {
  const session = statesBySession.get(sessionId)
  if (!session || oldUri === newUri) return
  const suffix = `\0${oldUri}`
  for (const [key, state] of [...session.entries()]) {
    if (!key.endsWith(suffix)) continue
    const viewStateId = key.slice(0, -suffix.length)
    session.set(editorViewStateKey(viewStateId, newUri), state)
    session.delete(key)
  }
}

export function clearEditorViewStates(sessionId: string): void {
  statesBySession.delete(sessionId)
}
