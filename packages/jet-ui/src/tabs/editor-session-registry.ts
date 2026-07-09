import { Text, type Extension } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import type { PanelId } from "@jet/shared"

export type EditorSession = {
  fileUri: string
  fileLanguageId: string
  lastKnownText: string
  largeFile: boolean
  savedBaseline: Text
  snapshotTimer: number | null
  view: EditorView
}

class EditorSessionRegistry {
  private viewByPanel = new Map<number, EditorView>()
  private sessionsByPanel = new Map<number, Map<string, EditorSession>>()
  private sessionAccessOrder: string[] = []
  private readonly maxCachedSessions = 32
  focusedPanelId: number | null = null

  private sessionKey(panelId: PanelId, fileUri: string): string {
    return `${panelId.id}\u0000${fileUri}`
  }

  touchSessionAccess(panelId: PanelId, fileUri: string): void {
    const key = this.sessionKey(panelId, fileUri)
    const idx = this.sessionAccessOrder.indexOf(key)
    if (idx >= 0) this.sessionAccessOrder.splice(idx, 1)
    this.sessionAccessOrder.push(key)
  }

  private forgetSessionAccess(panelId: PanelId, fileUri: string): void {
    const key = this.sessionKey(panelId, fileUri)
    const idx = this.sessionAccessOrder.indexOf(key)
    if (idx >= 0) this.sessionAccessOrder.splice(idx, 1)
  }

  evictStaleSessions(destroy: (panelId: PanelId, fileUri: string) => void): void {
    while (this.sessionAccessOrder.length > this.maxCachedSessions) {
      const key = this.sessionAccessOrder.shift()!
      const sep = key.indexOf("\u0000")
      const panelIdNum = Number(key.slice(0, sep))
      const fileUri = key.slice(sep + 1)
      destroy({ id: panelIdNum }, fileUri)
    }
  }

  panelSessions(panelId: PanelId): Map<string, EditorSession> {
    let sessions = this.sessionsByPanel.get(panelId.id)
    if (!sessions) {
      sessions = new Map()
      this.sessionsByPanel.set(panelId.id, sessions)
    }
    return sessions
  }

  getView(panelId: PanelId): EditorView | undefined {
    return this.viewByPanel.get(panelId.id)
  }

  setActiveView(panelId: PanelId, view: EditorView): void {
    this.viewByPanel.set(panelId.id, view)
  }

  clearActiveView(panelId: PanelId, view: EditorView): void {
    if (this.viewByPanel.get(panelId.id) === view) this.viewByPanel.delete(panelId.id)
    if (this.focusedPanelId === panelId.id && this.viewByPanel.get(panelId.id) == null) {
      this.focusedPanelId = null
    }
  }

  forEachView(fn: (entry: { panelId: PanelId; uri: string; view: EditorView }) => void): void {
    for (const [panelIdNum, sessions] of this.sessionsByPanel) {
      const panelId: PanelId = { id: panelIdNum }
      for (const [uri, session] of sessions) {
        fn({ panelId, uri, view: session.view })
      }
    }
  }

  getAllViews(): { panelId: PanelId; uri: string; view: EditorView }[] {
    const result: { panelId: PanelId; uri: string; view: EditorView }[] = []
    this.forEachView(entry => result.push(entry))
    return result
  }

  forEachSession(fn: (session: EditorSession) => void): void {
    for (const sessions of this.sessionsByPanel.values()) {
      for (const session of sessions.values()) {
        fn(session)
      }
    }
  }

  destroyBuffer(panelId: PanelId, fileUri: string): EditorSession | null {
    const sessions = this.sessionsByPanel.get(panelId.id)
    const session = sessions?.get(fileUri) ?? null
    if (!session) return null
    this.forgetSessionAccess(panelId, fileUri)
    if (session.snapshotTimer != null) window.clearTimeout(session.snapshotTimer)
    sessions!.delete(fileUri)
    if (sessions!.size === 0) this.sessionsByPanel.delete(panelId.id)
    this.clearActiveView(panelId, session.view)
    return session
  }

  destroyPanel(panelId: PanelId): EditorSession[] {
    const sessions = this.sessionsByPanel.get(panelId.id)
    if (!sessions) return []
    return [...sessions.values()]
  }
}

export const editorSessions = new EditorSessionRegistry()

export function textFromString(content: string): Text {
  return Text.of(content.split("\n"))
}

export function scheduleSessionSnapshot(session: EditorSession): void {
  if (session.snapshotTimer != null) window.clearTimeout(session.snapshotTimer)
  session.snapshotTimer = window.setTimeout(() => {
    session.snapshotTimer = null
    session.lastKnownText = session.view.state.doc.toString()
  }, 120)
}

export function clearSessionSnapshot(session: EditorSession): void {
  if (session.snapshotTimer != null) {
    window.clearTimeout(session.snapshotTimer)
    session.snapshotTimer = null
  }
}

export function detachSessionDom(session: EditorSession, parent: HTMLElement): void {
  if (session.view.dom.parentElement === parent) parent.removeChild(session.view.dom)
}

/** Re-export for callers that need the type without importing @codemirror/state. */
export type { Extension }
