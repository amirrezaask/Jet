import { memo, useEffect, useRef, useState } from "react"
import type { Extension } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import type { LSPClient } from "@gharargah/codemirror"
import {
  createGharargahEditorView,
  applyTheme,
  applyUserExtensions,
  applyUserKeymaps,
  consumePendingEditorNavigation,
  consumePendingInitialContent,
  detachLsp,
  detectIndent,
  isLargeFile,
  jetReloadAnnotation,
  jumpToLine,
  lspPluginForView,
  reconfigureLsp,
  closeJetSearchForView,
} from "@gharargah/codemirror"
import type { GharargahTheme } from "@gharargah/codemirror"
import type { KeymapContext, JetKeyBinding, WorkspaceService } from "@gharargah/workspace"
import type { PanelId } from "@gharargah/shared"
import { fileUriToPath, isUntitledUri } from "@gharargah/shared"
import { ContextMenu, ContextMenuTrigger } from "../components/ui/context-menu.js"
import {
  EditorContextMenu,
  registerEditorContextMenuHandler,
} from "@/components/EditorContextMenu.js"
import { dispatchContextMenuAt } from "@/components/ContextMenuHost.js"
import {
  editorSessions,
  textFromString,
  detachSessionDom,
  type EditorSession,
} from "./editor-session-registry.js"

function useLatest<T>(value: T): React.MutableRefObject<T> {
  const ref = useRef(value)
  ref.current = value
  return ref
}

export function destroyEditorBuffer(panelId: PanelId, fileUri: string): void {
  const session = editorSessions.destroyBuffer(panelId, fileUri)
  if (!session) return
  detachLsp(session.view)
  closeJetSearchForView(session.view)
  session.view.destroy()
}

export function destroyEditorPanel(panelId: PanelId): void {
  for (const session of editorSessions.destroyPanel(panelId)) {
    detachLsp(session.view)
    closeJetSearchForView(session.view)
    session.view.destroy()
  }
}

export function getEditorView(panelId: PanelId): EditorView | undefined {
  return editorSessions.getView(panelId)
}

export function syncAllEditorThemes(theme: GharargahTheme): void {
  editorSessions.forEachSession(session => {
    applyTheme(session.view, theme)
  })
}

export function forEachEditorView(
  fn: (entry: { panelId: PanelId; uri: string; view: EditorView }) => void,
): void {
  editorSessions.forEachView(fn)
}

export function getAllEditorViews(): { panelId: PanelId; uri: string; view: EditorView }[] {
  return editorSessions.getAllViews()
}

function EditorTabHostInner({
  panelId,
  fileUri,
  workspace,
  theme,
  resolveLspClient,
  lspRevision,
  executeCommand,
  runKeyBinding,
  keymapBindings,
  userExtensions,
  keymapRevision,
  keymapContext,
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
  resolveLspClient?: (fileUri: string) => Promise<LSPClient | null>
  lspRevision?: number
  executeCommand: (name: string) => Promise<void>
  runKeyBinding: (binding: JetKeyBinding, view?: EditorView) => void
  keymapBindings: JetKeyBinding[]
  userExtensions: Extension[]
  keymapRevision: number
  keymapContext?: KeymapContext
  onEditorFocusChange?: (focused: boolean) => void
  onEditorSelectionChange?: (line: number, column: number, rangeCount: number) => void
  onLspAttachFailed?: (fileUri: string) => void
  onProblemsChange?: () => void
  autoFocus?: boolean
}) {
  const executeCommandRef = useLatest(executeCommand)
  const runKeyBindingRef = useLatest(runKeyBinding)
  const keymapBindingsRef = useLatest(keymapBindings)
  const keymapContextRef = useLatest(keymapContext)
  const onEditorFocusChangeRef = useLatest(onEditorFocusChange)
  const onEditorSelectionChangeRef = useLatest(onEditorSelectionChange)
  const resolveLspClientRef = useLatest(resolveLspClient)
  const onLspAttachFailedRef = useLatest(onLspAttachFailed)
  const onProblemsChangeRef = useLatest(onProblemsChange)

  const hostRef = useRef<HTMLDivElement>(null)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)

  const runCommand = useRef((name: string) => executeCommandRef.current(name)).current
  const runBinding = useRef((binding: JetKeyBinding, view: EditorView) =>
    runKeyBindingRef.current(binding, view),
  ).current

  useEffect(() => {
    return registerEditorContextMenuHandler((x, y) => {
      if (editorSessions.focusedPanelId !== panelId.id) return
      if (hostRef.current) dispatchContextMenuAt(hostRef.current, x, y)
    })
  }, [panelId.id])

  useEffect(() => {
    const parent = hostRef.current
    if (!parent) return
    let cancelled = false
    let session = editorSessions.panelSessions(panelId).get(fileUri) ?? null
    let onFocus: (() => void) | null = null
    let onBlur: (() => void) | null = null

    const attachView = (live: EditorSession) => {
      editorSessions.touchSessionAccess(panelId, fileUri)
      for (const other of editorSessions.panelSessions(panelId).values()) {
        if (other !== live) detachSessionDom(other, parent)
      }
      if (live.view.dom.parentElement !== parent) parent.appendChild(live.view.dom)
      editorSessions.setActiveView(panelId, live.view)
      applyTheme(live.view, theme)
      applyUserKeymaps(live.view, keymapBindingsRef.current, runBinding, keymapContextRef.current)
      applyUserExtensions(live.view, userExtensions)
      const nav = consumePendingEditorNavigation(panelId)
      if (nav) jumpToLine(live.view, nav.line, nav.column)
      const focusHandler = () => {
        editorSessions.focusedPanelId = panelId.id
        onEditorFocusChangeRef.current?.(true)
      }
      const blurHandler = () => onEditorFocusChangeRef.current?.(false)
      onFocus = focusHandler
      onBlur = blurHandler
      live.view.dom.addEventListener("focus", focusHandler)
      live.view.dom.addEventListener("blur", blurHandler)
      onProblemsChangeRef.current?.()
    }

    if (session) {
      attachView(session)
    }

    void (async () => {
      if (!session) {
        const untitled = isUntitledUri(fileUri)
        const path = untitled ? "" : fileUriToPath(fileUri)
        let file = workspace.fileForUri(fileUri)
        if (!file) file = workspace.createWorkspaceFile(fileUri, path)

        let initialText = ""
        let savedBaseline = workspace.savedBaselineFor(fileUri) ?? (untitled ? "" : "")
        let largeFile = false

        if (!untitled) {
          const diskText = await workspace.readFile(fileUri)
          if (cancelled) return
          initialText = diskText
          savedBaseline = workspace.savedBaselineFor(fileUri) ?? diskText
          largeFile = isLargeFile(diskText)
        } else {
          const pending = consumePendingInitialContent(panelId)
          if (pending != null) {
            initialText = pending
            largeFile = isLargeFile(pending)
          }
        }

        const mount = document.createElement("div")
        const view = await createGharargahEditorView({
          parent: mount,
          workspace,
          file,
          initialText,
          largeFile,
          indent: detectIndent(initialText),
          theme,
          lspClient: null,
          executeCommand: runCommand,
          userExtensions,
          onSelectionChange: (line, column, rangeCount) =>
            onEditorSelectionChangeRef.current?.(line, column, rangeCount),
          onDocChange: doc => {
            const live = editorSessions.panelSessions(panelId).get(fileUri)
            if (!live) return
            live.isDirty = !doc.eq(live.savedBaseline)
            workspace.markDirty(fileUri, live.isDirty)
          },
          onViewUpdate: () => onProblemsChangeRef.current?.(),
        })
        if (cancelled) {
          view.destroy()
          return
        }

        session = {
          fileUri,
          fileLanguageId: file.languageId,
          isDirty: untitled && initialText.length > 0,
          largeFile,
          savedBaseline: textFromString(savedBaseline),
          view,
        }
        editorSessions.panelSessions(panelId).set(fileUri, session)
        editorSessions.touchSessionAccess(panelId, fileUri)
        editorSessions.evictStaleSessions(destroyEditorBuffer)

        workspace.setSavedBaseline(fileUri, savedBaseline)
        if (untitled && initialText.length > 0) {
          workspace.markDirty(fileUri, true)
        }

        if (!largeFile && !untitled && resolveLspClientRef.current) {
          void (async () => {
            const client = await resolveLspClientRef.current!(fileUri)
            if (cancelled) return
            if (!client) {
              onLspAttachFailedRef.current?.(fileUri)
              return
            }
            const live = editorSessions.panelSessions(panelId).get(fileUri)
            if (!live) return
            await reconfigureLsp(live.view, fileUri, live.fileLanguageId, client)
            onProblemsChangeRef.current?.()
          })()
        }
      }

      if (!session || cancelled) return
      attachView(session)
    })()

    return () => {
      cancelled = true
      const live = editorSessions.panelSessions(panelId).get(fileUri)
      if (live && onFocus && onBlur) {
        live.view.dom.removeEventListener("focus", onFocus)
        live.view.dom.removeEventListener("blur", onBlur)
      }
      if (live) detachSessionDom(live, parent)
    }
  }, [fileUri, panelId.id, workspace, runCommand, runBinding])

  useEffect(() => {
    for (const session of editorSessions.panelSessions(panelId).values()) {
      applyTheme(session.view, theme)
    }
  }, [panelId.id, theme])

  useEffect(() => {
    const view = editorSessions.getView(panelId)
    if (view) applyUserKeymaps(view, keymapBindingsRef.current, runBinding, keymapContext)
  }, [panelId.id, keymapRevision, keymapContext, runBinding])

  useEffect(() => {
    const view = editorSessions.getView(panelId)
    if (view) applyUserExtensions(view, userExtensions)
  }, [panelId.id, userExtensions])

  useEffect(() => {
    if (!autoFocus) return
    editorSessions.getView(panelId)?.focus()
  }, [panelId.id, autoFocus, fileUri])

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
      await reconfigureLsp(session.view, fileUri, session.fileLanguageId, client)
      onProblemsChangeRef.current?.()
    })()
    return () => {
      cancelled = true
    }
  }, [lspRevision, resolveLspClient, fileUri, panelId.id])

  useEffect(() => {
    const sub = workspace.onDidChangeSavedBaseline.event(({ uri, content }) => {
      if (uri !== fileUri) return
      const session = editorSessions.panelSessions(panelId).get(fileUri)
      if (!session) return
      session.savedBaseline = textFromString(content)
      session.isDirty = !session.view.state.doc.eq(session.savedBaseline)
      workspace.markDirty(uri, session.isDirty)
    })
    return () => sub.dispose()
  }, [workspace, fileUri, panelId.id])

  useEffect(() => {
    const sub = workspace.onFileReload.event(({ uri, content }) => {
      if (uri !== fileUri) return
      const session = editorSessions.panelSessions(panelId).get(fileUri)
      if (!session) return
      session.view.dispatch({
        changes: { from: 0, to: session.view.state.doc.length, insert: content },
        annotations: jetReloadAnnotation.of(true),
      })
      onProblemsChangeRef.current?.()
    })
    return () => sub.dispose()
  }, [workspace, fileUri, panelId.id])

  const activeView = editorSessions.getView(panelId) ?? null

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
        />
      </ContextMenuTrigger>
      <EditorContextMenu
        open={contextMenuOpen}
        view={activeView}
        lspAvailable={Boolean(typeof window !== "undefined" && window.gharargah?.lsp)}
        hasLspPlugin={activeView != null && lspPluginForView(activeView) != null}
        executeCommand={runCommand}
      />
    </ContextMenu>
  )
}

export const EditorTabHost = memo(EditorTabHostInner)
