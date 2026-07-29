import { memo, useCallback, useEffect, useRef, useState } from "react"
import type { GharargahTheme } from "@gharargah/shared"
import { fileUriToPath, isUntitledUri } from "@gharargah/shared"
import type { KeymapContext, JetKeyBinding, WorkspaceService } from "@gharargah/workspace"
import type { PanelId } from "@gharargah/shared"
import {
  MonacoEditorHost,
  isLargeFile,
  monacoModels,
  setPendingInitialContent,
  consumePendingInitialContent,
  consumePendingEditorNavigation,
  applyPendingNavigation,
  setActiveMonacoEditor,
  type MonacoEditorHandle,
} from "@gharargah/monaco"
import { ContextMenu, ContextMenuTrigger } from "../components/ui/context-menu.js"
import {
  EditorContextMenu,
  registerEditorContextMenuHandler,
} from "@/components/EditorContextMenu.js"
import { dispatchContextMenuAt } from "@/components/ContextMenuHost.js"
import { editorSessions, type EditorSession } from "./editor-session-registry.js"
import {
  destroyEditorBuffer as destroyEditorBufferPublic,
  onDestroyEditorBuffer,
  onDestroyEditorPanel,
  registerEditorView,
} from "./editor-view-registry.js"

export {
  getEditorView,
  destroyEditorBuffer,
  destroyEditorPanel,
} from "./editor-view-registry.js"

onDestroyEditorBuffer((panelId, fileUri) => {
  editorSessions.destroyBuffer(panelId, fileUri)
})
onDestroyEditorPanel(panelId => {
  editorSessions.destroyPanel(panelId)
})

function useLatest<T>(value: T): React.MutableRefObject<T> {
  const ref = useRef(value)
  ref.current = value
  return ref
}

export function getEditorCursor(panelId: PanelId): { line: number; column: number } | null {
  const editor = editorSessions.getEditor(panelId)
  if (!editor) return null
  const pos = editor.getPosition()
  if (!pos) return null
  return { line: pos.lineNumber, column: pos.column }
}

export function setEditorCursor(panelId: PanelId, line: number, column: number): void {
  const editor = editorSessions.getEditor(panelId)
  if (!editor) return
  editor.setPosition({ lineNumber: line, column })
  editor.revealPositionInCenter({ lineNumber: line, column })
}

export function syncAllEditorThemes(_theme: GharargahTheme): void {
  // Theme applied via MonacoEditorHost prop / applyGharargahMonacoTheme
}

export function forEachEditorView(
  fn: (entry: { panelId: PanelId; uri: string }) => void,
): void {
  editorSessions.forEachUri(fn)
}

export function getAllEditorViews(): { panelId: PanelId; uri: string }[] {
  const result: { panelId: PanelId; uri: string }[] = []
  editorSessions.forEachUri(entry => result.push(entry))
  return result
}

function EditorTabHostInner({
  panelId,
  fileUri,
  workspace,
  theme,
  resolveLspClient,
  lspRevision,
  executeCommand,
  runKeyBinding: _runKeyBinding,
  keymapBindings: _keymapBindings,
  userExtensions: _userExtensions,
  keymapRevision: _keymapRevision,
  keymapContext: _keymapContext,
  onEditorFocusChange,
  onEditorSelectionChange,
  onLspAttachFailed,
  onProblemsChange,
  autoFocus = false,
}: {
  panelId: PanelId
  fileUri: string
  workspace: WorkspaceService
  theme: GharargahTheme
  resolveLspClient?: (fileUri: string) => Promise<unknown>
  lspRevision?: number
  executeCommand: (name: string) => Promise<void>
  runKeyBinding: (binding: JetKeyBinding, view?: MonacoEditorHandle) => void
  keymapBindings: JetKeyBinding[]
  userExtensions: unknown[]
  keymapRevision: number
  keymapContext?: KeymapContext
  onEditorFocusChange?: (focused: boolean) => void
  onEditorSelectionChange?: (line: number, column: number, rangeCount: number) => void
  onLspAttachFailed?: (fileUri: string) => void
  onProblemsChange?: () => void
  autoFocus?: boolean
}) {
  const executeCommandRef = useLatest(executeCommand)
  const onEditorFocusChangeRef = useLatest(onEditorFocusChange)
  const onEditorSelectionChangeRef = useLatest(onEditorSelectionChange)
  const resolveLspClientRef = useLatest(resolveLspClient)
  const onLspAttachFailedRef = useLatest(onLspAttachFailed)
  const onProblemsChangeRef = useLatest(onProblemsChange)

  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const [ready, setReady] = useState(false)
  const [content, setContent] = useState<string | null>(null)
  const [languageId, setLanguageId] = useState("plaintext")
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<MonacoEditorHandle | null>(null)

  const runCommand = useCallback(
    (name: string) => executeCommandRef.current(name),
    [executeCommandRef],
  )

  useEffect(() => {
    return registerEditorContextMenuHandler((x, y) => {
      if (editorSessions.focusedPanelId !== panelId.id) return
      if (hostRef.current) dispatchContextMenuAt(hostRef.current, x, y)
    })
  }, [panelId.id])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const untitled = isUntitledUri(fileUri)
      const path = untitled ? "" : fileUriToPath(fileUri)
      let file = workspace.fileForUri(fileUri)
      if (!file) file = workspace.createWorkspaceFile(fileUri, path)

      const cachedSession = editorSessions.panelSessions(panelId).get(fileUri)
      const cachedModel = monacoModels.get(fileUri)
      if (cachedSession && cachedModel) {
        editorSessions.touchSessionAccess(panelId, fileUri)
        setLanguageId(cachedSession.fileLanguageId)
        setContent(cachedModel.getValue())
        setReady(true)
        if (
          !cachedSession.largeFile &&
          !untitled &&
          resolveLspClientRef.current
        ) {
          void resolveLspClientRef.current(fileUri).then(client => {
            if (cancelled) return
            if (!client) onLspAttachFailedRef.current?.(fileUri)
            else onProblemsChangeRef.current?.()
          })
        }
        return
      }

      let initialText = ""
      let savedBaseline = workspace.savedBaselineFor(fileUri) ?? ""
      let largeFile = false

      const existing = monacoModels.get(fileUri)
      if (existing) {
        initialText = existing.getValue()
        savedBaseline = workspace.savedBaselineFor(fileUri) ?? initialText
        largeFile = isLargeFile(initialText)
      } else if (!untitled) {
        const diskText = await workspace.readFile(fileUri)
        if (cancelled) return
        initialText = diskText
        savedBaseline = workspace.savedBaselineFor(fileUri) ?? diskText
        largeFile = isLargeFile(diskText)
      } else {
        const pending = consumePendingInitialContent(fileUri)
        if (pending != null) {
          initialText = pending
          largeFile = isLargeFile(pending)
        }
      }

      if (cancelled) return

      // The session owns one model reference independently of the mounted editor.
      // This preserves undo history and avoids re-reading the file on every tab switch.
      const model = monacoModels.getOrCreate(fileUri, initialText, file.languageId)
      const session: EditorSession = {
        fileUri,
        fileLanguageId: file.languageId,
        isDirty: untitled && initialText.length > 0,
        largeFile,
        savedBaseline,
        savedAlternativeVersionId:
          untitled && initialText.length > 0
            ? null
            : model.getAlternativeVersionId(),
      }
      editorSessions.panelSessions(panelId).set(fileUri, session)
      editorSessions.touchSessionAccess(panelId, fileUri)
      editorSessions.evictStaleSessions(destroyEditorBufferPublic)

      workspace.setSavedBaseline(fileUri, savedBaseline)
      if (untitled && initialText.length > 0) {
        workspace.markDirty(fileUri, true)
      }

      setLanguageId(file.languageId)
      setContent(initialText)
      setReady(true)

      if (!largeFile && !untitled && resolveLspClientRef.current) {
        void (async () => {
          const client = await resolveLspClientRef.current!(fileUri)
          if (cancelled) return
          if (!client) {
            onLspAttachFailedRef.current?.(fileUri)
            return
          }
          onProblemsChangeRef.current?.()
        })()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [fileUri, panelId.id, workspace])

  useEffect(() => {
    if (lspRevision == null || lspRevision === 0 || !resolveLspClient) return
    const session = editorSessions.panelSessions(panelId).get(fileUri)
    if (!session || session.largeFile || isUntitledUri(fileUri)) return
    let cancelled = false
    void (async () => {
      const client = await resolveLspClient(fileUri)
      if (cancelled) return
      if (!client) {
        onLspAttachFailedRef.current?.(fileUri)
        return
      }
      onProblemsChangeRef.current?.()
    })()
    return () => {
      cancelled = true
    }
  }, [lspRevision, resolveLspClient, fileUri, panelId])

  useEffect(() => {
    const sub = workspace.onDidChangeSavedBaseline.event(({ uri, content: baseline }) => {
      if (uri !== fileUri) return
      const session = editorSessions.panelSessions(panelId).get(fileUri)
      if (!session) return
      session.savedBaseline = baseline
      const model = monacoModels.get(fileUri)
      session.savedAlternativeVersionId =
        model?.getAlternativeVersionId() ?? session.savedAlternativeVersionId
      session.isDirty = false
      workspace.markDirty(uri, session.isDirty)
    })
    return () => sub.dispose()
  }, [workspace, fileUri, panelId])

  useEffect(() => {
    const sub = workspace.onFileReload.event(({ uri, content: next }) => {
      if (uri !== fileUri) return
      monacoModels.updateContent(uri, next, { preserveCursor: true })
      const session = editorSessions.panelSessions(panelId).get(fileUri)
      const model = monacoModels.get(uri)
      if (session && model) {
        session.savedBaseline = next
        session.savedAlternativeVersionId = model.getAlternativeVersionId()
        session.isDirty = false
        workspace.markDirty(uri, false)
      }
      onProblemsChangeRef.current?.()
    })
    return () => sub.dispose()
  }, [workspace, fileUri])

  const handleReady = useCallback(
    (editor: MonacoEditorHandle) => {
      editorRef.current = editor
      editorSessions.setActiveEditor(panelId, editor)
      registerEditorView(panelId, editor)
      setActiveMonacoEditor(editor)
      applyPendingNavigation(editor, fileUri)
      const nav = consumePendingEditorNavigation(fileUri)
      if (nav) {
        editor.setPosition({ lineNumber: nav.line, column: nav.column ?? 1 })
        editor.revealPositionInCenter({ lineNumber: nav.line, column: nav.column ?? 1 })
      }
      onProblemsChangeRef.current?.()
    },
    [panelId, fileUri, onProblemsChangeRef],
  )

  useEffect(() => {
    return () => {
      const editor = editorRef.current
      if (!editor) return
      registerEditorView(panelId, null)
      editorSessions.clearActiveEditor(panelId, editor)
      editorRef.current = null
    }
  }, [panelId])

  const handleContentChange = useCallback(
    (model: NonNullable<ReturnType<MonacoEditorHandle["getModel"]>>) => {
      const session = editorSessions.panelSessions(panelId).get(fileUri)
      if (!session) return
      session.isDirty =
        session.savedAlternativeVersionId == null ||
        model.getAlternativeVersionId() !== session.savedAlternativeVersionId
      workspace.markDirty(fileUri, session.isDirty)
      onProblemsChangeRef.current?.()
    },
    [panelId, fileUri, workspace, onProblemsChangeRef],
  )

  const handleFocusChange = useCallback(
    (focused: boolean) => {
      if (focused) {
        editorSessions.focusedPanelId = panelId.id
        if (editorRef.current) {
          editorSessions.setActiveEditor(panelId, editorRef.current)
          registerEditorView(panelId, editorRef.current)
          setActiveMonacoEditor(editorRef.current)
        }
      }
      onEditorFocusChangeRef.current?.(focused)
    },
    [panelId, onEditorFocusChangeRef],
  )

  const handleCursorChange = useCallback(
    (line: number, column: number) => {
      onEditorSelectionChangeRef.current?.(line, column, 1)
    },
    [onEditorSelectionChangeRef],
  )

  const activeEditor = editorSessions.getEditor(panelId) ?? null

  return (
    <ContextMenu
      onOpenChange={open => {
        setContextMenuOpen(open)
        if (open) editorSessions.focusedPanelId = panelId.id
      }}
    >
      <ContextMenuTrigger asChild>
        <div
          ref={hostRef}
          className="jet-editor-scroll-area h-full min-h-0 w-full min-w-0 overflow-hidden"
          data-gharargah-editor-scroll-area=""
        >
          {ready && content != null ? (
            <MonacoEditorHost
              uri={fileUri}
              content={content}
              languageId={languageId}
              theme={theme}
              autoFocus={autoFocus}
              viewStateId={`panel-${panelId.id}`}
              onReady={handleReady}
              onContentChange={handleContentChange}
              onFocusChange={handleFocusChange}
              onCursorChange={handleCursorChange}
              onQuickOpen={() =>
                void executeCommandRef.current("workspace.quickOpen")
              }
              onCommandPalette={() =>
                void executeCommandRef.current("ui.showCommandPalette")
              }
            />
          ) : null}
        </div>
      </ContextMenuTrigger>
      <EditorContextMenu
        open={contextMenuOpen}
        view={activeEditor as never}
        lspAvailable={Boolean(typeof window !== "undefined" && window.gharargah?.lsp)}
        hasLspPlugin={Boolean(resolveLspClient)}
        executeCommand={runCommand}
      />
    </ContextMenu>
  )
}

export const EditorTabHost = memo(EditorTabHostInner)

/** Re-export for callers that previously set pending content via CM helpers. */
export { setPendingInitialContent }
