import { memo, useEffect, useRef, useState } from "react"
import { Text, type Extension } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import type { LSPClient } from "@jet/codemirror"
import {
  createJetEditorView,
  applyTheme,
  reconfigureLanguage,
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
} from "@jet/codemirror"
import type { JetTheme } from "@jet/codemirror"
import type { KeymapContext, JetKeyBinding, WorkspaceService } from "@jet/workspace"
import type { PanelId } from "@jet/shared"
import { fileUriToPath, isUntitledUri } from "@jet/shared"
import { ContextMenu, ContextMenuTrigger } from "../components/ui/context-menu.js"
import {
  EditorContextMenu,
  registerEditorContextMenuHandler,
} from "../components/EditorContextMenu.js"

type EditorSession = {
  fileUri: string
  fileLanguageId: string
  lastKnownText: string
  largeFile: boolean
  savedBaseline: Text
  snapshotTimer: number | null
  view: EditorView
}

const viewByPanel = new Map<number, EditorView>()
const sessionsByPanel = new Map<number, Map<string, EditorSession>>()
let focusedPanelId: number | null = null

function textFromString(content: string): Text {
  return Text.of(content.split("\n"))
}

function panelSessions(panelId: PanelId): Map<string, EditorSession> {
  let sessions = sessionsByPanel.get(panelId.id)
  if (!sessions) {
    sessions = new Map()
    sessionsByPanel.set(panelId.id, sessions)
  }
  return sessions
}

function scheduleSessionSnapshot(session: EditorSession): void {
  if (session.snapshotTimer != null) window.clearTimeout(session.snapshotTimer)
  session.snapshotTimer = window.setTimeout(() => {
    session.snapshotTimer = null
    session.lastKnownText = session.view.state.doc.toString()
  }, 120)
}

function clearSessionSnapshot(session: EditorSession): void {
  if (session.snapshotTimer != null) {
    window.clearTimeout(session.snapshotTimer)
    session.snapshotTimer = null
  }
}

function detachSessionDom(session: EditorSession, parent: HTMLElement): void {
  if (session.view.dom.parentElement === parent) parent.removeChild(session.view.dom)
}

export function destroyEditorBuffer(panelId: PanelId, fileUri: string): void {
  const sessions = sessionsByPanel.get(panelId.id)
  const session = sessions?.get(fileUri)
  if (!session) return
  clearSessionSnapshot(session)
  detachLsp(session.view)
  closeJetSearchForView(session.view)
  session.view.destroy()
  sessions!.delete(fileUri)
  if (sessions!.size === 0) sessionsByPanel.delete(panelId.id)
  if (viewByPanel.get(panelId.id) === session.view) viewByPanel.delete(panelId.id)
  if (focusedPanelId === panelId.id && viewByPanel.get(panelId.id) == null) focusedPanelId = null
}

export function destroyEditorPanel(panelId: PanelId): void {
  const sessions = sessionsByPanel.get(panelId.id)
  if (!sessions) return
  for (const fileUri of [...sessions.keys()]) {
    destroyEditorBuffer(panelId, fileUri)
  }
}

export function getEditorView(panelId: PanelId): EditorView | undefined {
  return viewByPanel.get(panelId.id)
}

/** Re-apply editor chrome + syntax highlighting on every live buffer (including cached sessions). */
export function syncAllEditorThemes(theme: JetTheme): void {
  for (const sessions of sessionsByPanel.values()) {
    for (const session of sessions.values()) {
      applyTheme(session.view, theme)
      void reconfigureLanguage(session.view, session.fileLanguageId, theme)
    }
  }
}

export function forEachEditorView(
  fn: (entry: { panelId: PanelId; uri: string; view: EditorView }) => void,
): void {
  for (const [panelIdNum, sessions] of sessionsByPanel) {
    const panelId: PanelId = { id: panelIdNum }
    for (const [uri, session] of sessions) {
      fn({ panelId, uri, view: session.view })
    }
  }
}

export function getAllEditorViews(): { panelId: PanelId; uri: string; view: EditorView }[] {
  const result: { panelId: PanelId; uri: string; view: EditorView }[] = []
  forEachEditorView(entry => result.push(entry))
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
  theme: JetTheme
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
  const executeCommandRef = useRef(executeCommand)
  executeCommandRef.current = executeCommand
  const runKeyBindingRef = useRef(runKeyBinding)
  runKeyBindingRef.current = runKeyBinding
  const keymapBindingsRef = useRef(keymapBindings)
  keymapBindingsRef.current = keymapBindings
  const keymapContextRef = useRef(keymapContext)
  keymapContextRef.current = keymapContext
  const onEditorFocusChangeRef = useRef(onEditorFocusChange)
  onEditorFocusChangeRef.current = onEditorFocusChange
  const onEditorSelectionChangeRef = useRef(onEditorSelectionChange)
  onEditorSelectionChangeRef.current = onEditorSelectionChange
  const resolveLspClientRef = useRef(resolveLspClient)
  resolveLspClientRef.current = resolveLspClient
  const onLspAttachFailedRef = useRef(onLspAttachFailed)
  onLspAttachFailedRef.current = onLspAttachFailed
  const onProblemsChangeRef = useRef(onProblemsChange)
  onProblemsChangeRef.current = onProblemsChange
  const hostRef = useRef<HTMLDivElement>(null)
  const [contextMenuOpen, setContextMenuOpen] = useState(false)

  const runCommand = useRef((name: string) => executeCommandRef.current(name)).current
  const runBinding = useRef((binding: JetKeyBinding, view: EditorView) =>
    runKeyBindingRef.current(binding, view),
  ).current

  useEffect(() => {
    return registerEditorContextMenuHandler((x, y) => {
      if (focusedPanelId !== panelId.id) return
      hostRef.current?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          view: window,
        }),
      )
    })
  }, [panelId.id])

  useEffect(() => {
    const parent = hostRef.current
    if (!parent) return
    let cancelled = false
    let session = panelSessions(panelId).get(fileUri) ?? null
    let onFocus: (() => void) | null = null
    let onBlur: (() => void) | null = null

    const attachView = (live: EditorSession) => {
      for (const other of panelSessions(panelId).values()) {
        if (other !== live) detachSessionDom(other, parent)
      }
      if (live.view.dom.parentElement !== parent) parent.appendChild(live.view.dom)
      viewByPanel.set(panelId.id, live.view)
      applyTheme(live.view, theme)
      void reconfigureLanguage(live.view, live.fileLanguageId, theme)
      applyUserKeymaps(live.view, keymapBindingsRef.current, runBinding, keymapContextRef.current)
      applyUserExtensions(live.view, userExtensions)
      const nav = consumePendingEditorNavigation(panelId)
      if (nav) jumpToLine(live.view, nav.line, nav.column)
      const focusHandler = () => {
        focusedPanelId = panelId.id
        onEditorFocusChangeRef.current?.(true)
      }
      const blurHandler = () => onEditorFocusChangeRef.current?.(false)
      onFocus = focusHandler
      onBlur = blurHandler
      live.view.dom.addEventListener("focus", focusHandler)
      live.view.dom.addEventListener("blur", blurHandler)
      onProblemsChangeRef.current?.()
    }

    // Cached sessions must attach synchronously — deferring to a microtask leaves a
    // blank editor when keepMounted:false remounts the tab after a switch.
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
        const view = await createJetEditorView({
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
          onDocChange: (doc, meta) => {
            const live = panelSessions(panelId).get(fileUri)
            if (!live) return
            workspace.markDirty(fileUri, !doc.eq(live.savedBaseline))
            if (!meta.isReload) scheduleSessionSnapshot(live)
            onProblemsChangeRef.current?.()
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
          lastKnownText: initialText,
          largeFile,
          savedBaseline: textFromString(savedBaseline),
          snapshotTimer: null,
          view,
        }
        panelSessions(panelId).set(fileUri, session)

        workspace.setSavedBaseline(fileUri, savedBaseline)
        if (untitled && initialText.length > 0) {
          workspace.markDirty(fileUri, true)
          scheduleSessionSnapshot(session)
        }

        if (!largeFile && !untitled && resolveLspClientRef.current) {
          void (async () => {
            const client = await resolveLspClientRef.current!(fileUri)
            if (cancelled) return
            if (!client) {
              onLspAttachFailedRef.current?.(fileUri)
              return
            }
            const live = panelSessions(panelId).get(fileUri)
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
      const live = panelSessions(panelId).get(fileUri)
      if (live && onFocus && onBlur) {
        live.view.dom.removeEventListener("focus", onFocus)
        live.view.dom.removeEventListener("blur", onBlur)
      }
      if (live) detachSessionDom(live, parent)
    }
  }, [fileUri, panelId.id, workspace, userExtensions, theme, runCommand, runBinding])

  useEffect(() => {
    for (const session of panelSessions(panelId).values()) {
      applyTheme(session.view, theme)
      void reconfigureLanguage(session.view, session.fileLanguageId, theme)
    }
  }, [panelId.id, theme])

  useEffect(() => {
    const view = viewByPanel.get(panelId.id)
    if (view) applyUserKeymaps(view, keymapBindingsRef.current, runBinding, keymapContext)
  }, [panelId.id, keymapRevision, keymapContext, runBinding])

  useEffect(() => {
    const view = viewByPanel.get(panelId.id)
    if (view) applyUserExtensions(view, userExtensions)
  }, [panelId.id, userExtensions])

  useEffect(() => {
    if (!autoFocus) return
    const view = viewByPanel.get(panelId.id)
    view?.focus()
  }, [panelId.id, autoFocus, fileUri])

  useEffect(() => {
    if (lspRevision == null || lspRevision === 0 || !resolveLspClient) return
    const session = panelSessions(panelId).get(fileUri)
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
      const session = panelSessions(panelId).get(fileUri)
      if (!session) return
      session.savedBaseline = textFromString(content)
      session.lastKnownText = content
      workspace.markDirty(uri, !session.view.state.doc.eq(session.savedBaseline))
    })
    return () => sub.dispose()
  }, [workspace, fileUri, panelId.id])

  useEffect(() => {
    const sub = workspace.onFileReload.event(({ uri, content }) => {
      if (uri !== fileUri) return
      const session = panelSessions(panelId).get(fileUri)
      if (!session) return
      session.lastKnownText = content
      session.view.dispatch({
        changes: { from: 0, to: session.view.state.doc.length, insert: content },
        annotations: jetReloadAnnotation.of(true),
      })
      onProblemsChangeRef.current?.()
    })
    return () => sub.dispose()
  }, [workspace, fileUri, panelId.id])

  const activeView = viewByPanel.get(panelId.id) ?? null

  return (
    <ContextMenu
      onOpenChange={open => {
        setContextMenuOpen(open)
        if (open) focusedPanelId = panelId.id
      }}
    >
      <ContextMenuTrigger asChild>
        <div
          ref={hostRef}
          className="jet-editor-scroll-area h-full min-h-0 w-full min-w-0 overflow-hidden"
          data-jet-editor-scroll-area=""
        />
      </ContextMenuTrigger>
      <EditorContextMenu
        open={contextMenuOpen}
        view={activeView}
        lspAvailable={Boolean(typeof window !== "undefined" && window.jet?.lsp)}
        hasLspPlugin={activeView != null && lspPluginForView(activeView) != null}
        executeCommand={runCommand}
      />
    </ContextMenu>
  )
}

export const EditorTabHost = memo(EditorTabHostInner)
