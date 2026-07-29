import type { PanelId } from "@gharargah/shared"
import type { MonacoEditorHandle } from "@gharargah/monaco"
import { monacoModels } from "@gharargah/monaco"

export type EditorSession = {
  fileUri: string
  fileLanguageId: string
  isDirty: boolean
  largeFile: boolean
  savedBaseline: string
  /** Null until an initially-dirty untitled buffer has been saved at least once. */
  savedAlternativeVersionId: number | null
}

class EditorSessionRegistry {
  private editorByPanel = new Map<number, MonacoEditorHandle>()
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
        const content = monacoModels.getContent(session.fileUri) ?? ""
        total += content.length * 2
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
        const active = this.editorByPanel.get(panelIdNum)
        const activeUri = active ? monacoModels.canonicalKey(active.getModel()?.uri.toString() ?? "") : ""
        return (
          session != null &&
          !session.isDirty &&
          activeUri !== monacoModels.canonicalKey(fileUri)
        )
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

  getEditor(panelId: PanelId): MonacoEditorHandle | undefined {
    return this.editorByPanel.get(panelId.id)
  }

  /** @deprecated Use getEditor — kept for gradual migration of call sites. */
  getView(panelId: PanelId): MonacoEditorHandle | undefined {
    return this.getEditor(panelId)
  }

  setActiveEditor(panelId: PanelId, editor: MonacoEditorHandle): void {
    this.editorByPanel.set(panelId.id, editor)
  }

  clearActiveEditor(panelId: PanelId, editor: MonacoEditorHandle): void {
    if (this.editorByPanel.get(panelId.id) === editor) this.editorByPanel.delete(panelId.id)
    if (this.focusedPanelId === panelId.id && this.editorByPanel.get(panelId.id) == null) {
      this.focusedPanelId = null
    }
  }

  forEachSession(fn: (session: EditorSession) => void): void {
    for (const sessions of this.sessionsByPanel.values()) {
      for (const session of sessions.values()) {
        fn(session)
      }
    }
  }

  forEachUri(fn: (entry: { panelId: PanelId; uri: string }) => void): void {
    for (const [panelIdNum, sessions] of this.sessionsByPanel) {
      const panelId: PanelId = { id: panelIdNum }
      for (const uri of sessions.keys()) {
        fn({ panelId, uri })
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
    monacoModels.release(fileUri)
    monacoModels.disposeIfUnreferenced(fileUri, () => !session.isDirty)
    return session
  }

  destroyPanel(panelId: PanelId): EditorSession[] {
    const sessions = this.sessionsByPanel.get(panelId.id)
    if (!sessions) return []
    const destroyed = [...sessions.values()]
    for (const session of destroyed) {
      this.forgetSessionAccess(panelId, session.fileUri)
      monacoModels.release(session.fileUri)
      monacoModels.disposeIfUnreferenced(session.fileUri, () => !session.isDirty)
    }
    this.sessionsByPanel.delete(panelId.id)
    this.editorByPanel.delete(panelId.id)
    if (this.focusedPanelId === panelId.id) this.focusedPanelId = null
    return destroyed
  }
}

export const editorSessions = new EditorSessionRegistry()
