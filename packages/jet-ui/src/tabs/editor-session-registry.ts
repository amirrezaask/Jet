import { Text, type Extension } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import type { PanelId } from "@jet/shared"

export type EditorSession = {
  fileUri: string
  fileLanguageId: string
  isDirty: boolean
  largeFile: boolean
  savedBaseline: Text
  view: EditorView
}

class EditorSessionRegistry {
  private viewByPanel = new Map<number, EditorView>()
  private sessionsByPanel = new Map<number, Map<string, EditorSession>>()
  private sessionAccessOrder: string[] = []
  private readonly maxCachedSessions = 8
  private readonly maxCachedDocumentBytes = 64 * 1024 * 1024
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
    const cachedDocumentBytes = () => {
      let total = 0
      this.forEachSession(session => {
        total += session.view.state.doc.length * 2
      })
      return total
    }

    while (
      this.sessionAccessOrder.length > this.maxCachedSessions ||
      cachedDocumentBytes() > this.maxCachedDocumentBytes
    ) {
      const candidateIndex = this.sessionAccessOrder.findIndex(key => {
        const sep = key.indexOf("\u0000")
        const panelIdNum = Number(key.slice(0, sep))
        const fileUri = key.slice(sep + 1)
        const session = this.sessionsByPanel.get(panelIdNum)?.get(fileUri)
        return session != null && !session.isDirty && this.viewByPanel.get(panelIdNum) !== session.view
      })
      if (candidateIndex < 0) break
      const [key] = this.sessionAccessOrder.splice(candidateIndex, 1)
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
    sessions!.delete(fileUri)
    if (sessions!.size === 0) this.sessionsByPanel.delete(panelId.id)
    this.clearActiveView(panelId, session.view)
    return session
  }

  destroyPanel(panelId: PanelId): EditorSession[] {
    const sessions = this.sessionsByPanel.get(panelId.id)
    if (!sessions) return []
    const destroyed = [...sessions.values()]
    for (const session of destroyed) this.forgetSessionAccess(panelId, session.fileUri)
    this.sessionsByPanel.delete(panelId.id)
    this.viewByPanel.delete(panelId.id)
    if (this.focusedPanelId === panelId.id) this.focusedPanelId = null
    return destroyed
  }
}

export const editorSessions = new EditorSessionRegistry()

export function textFromString(content: string): Text {
  return Text.of(content.split("\n"))
}

export function detachSessionDom(session: EditorSession, parent: HTMLElement): void {
  if (session.view.dom.parentElement === parent) parent.removeChild(session.view.dom)
}

/** Re-export for callers that need the type without importing @codemirror/state. */
export type { Extension }
