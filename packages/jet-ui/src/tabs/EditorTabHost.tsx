import { memo, useEffect, useRef, useState } from "react"
import { Text, type Extension } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import type { LSPClient } from "@jet/codemirror"
import {
  createJetEditorView,
  applyTheme,
  applyUserExtensions,
  applyUserKeymaps,
  consumePendingEditorNavigation,
  consumePendingInitialContent,
  detachLsp,
  isLargeFile,
  jetReloadAnnotation,
  jumpToLine,
  lspPluginForView,
  reconfigureLsp,
} from "@jet/codemirror"
import type { JetTheme } from "@jet/codemirror"
import type { KeymapContext, JetKeyBinding, TabRegistry, WorkspaceService } from "@jet/workspace"
import type { TabId } from "@jet/shared"
import { fileUriToPath, isUntitledUri } from "@jet/shared"
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

const viewByTab = new Map<number, EditorView>()
const sessionByTab = new Map<number, EditorSession>()
let focusedTabId: number | null = null

function textFromString(content: string): Text {
  return Text.of(content.split("\n"))
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

function destroyEditorSession(tabId: TabId): void {
  const session = sessionByTab.get(tabId.id)
  if (!session) return
  clearSessionSnapshot(session)
  detachLsp(session.view)
  session.view.destroy()
  sessionByTab.delete(tabId.id)
  viewByTab.delete(tabId.id)
  if (focusedTabId === tabId.id) focusedTabId = null
}

export function getEditorView(tabId: TabId): EditorView | undefined {
  return viewByTab.get(tabId.id)
}

export function getAllEditorViews(
  registry: TabRegistry,
): { tabId: TabId; uri: string; view: EditorView }[] {
  const result: { tabId: TabId; uri: string; view: EditorView }[] = []
  for (const tabId of registry.allTabs()) {
    const kind = registry.get(tabId)
    const view = viewByTab.get(tabId.id)
    if (kind?.kind === "editor" && view) result.push({ tabId, uri: kind.fileUri, view })
  }
  return result
}

function EditorTabHostInner({
  tabId,
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
  tabId: TabId
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
  onEditorSelectionChange?: (line: number, column: number) => void
  onLspAttachFailed?: (fileUri: string) => void
  onProblemsChange?: () => void
  autoFocus?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  const runCommand = useRef((name: string) => executeCommandRef.current(name)).current
  const runBinding = useRef((binding: JetKeyBinding, view: EditorView) =>
    runKeyBindingRef.current(binding, view),
  ).current

  useEffect(() => {
    return registerEditorContextMenuHandler((x, y) => {
      if (focusedTabId !== tabId.id) return
      setContextMenu({ x, y })
    })
  }, [tabId.id])

  useEffect(() => {
    const parent = ref.current
    if (!parent) return
    let cancelled = false
    let session = sessionByTab.get(tabId.id) ?? null
    let onFocus: (() => void) | null = null
    let onBlur: (() => void) | null = null
    let onContextMenu: ((e: MouseEvent) => void) | null = null

    const attachView = (live: EditorSession) => {
      if (live.view.dom.parentElement !== parent) parent.appendChild(live.view.dom)
      applyTheme(live.view, theme)
      applyUserKeymaps(live.view, keymapBindingsRef.current, runBinding, keymapContextRef.current)
      applyUserExtensions(live.view, userExtensions)
      const nav = consumePendingEditorNavigation(tabId)
      if (nav) jumpToLine(live.view, nav.line, nav.column)
      onFocus = () => {
        focusedTabId = tabId.id
        onEditorFocusChangeRef.current?.(true)
      }
      onBlur = () => onEditorFocusChangeRef.current?.(false)
      onContextMenu = (e: MouseEvent) => {
        e.preventDefault()
        focusedTabId = tabId.id
        setContextMenu({ x: e.clientX, y: e.clientY })
      }
      live.view.dom.addEventListener("focus", onFocus)
      live.view.dom.addEventListener("blur", onBlur)
      live.view.dom.addEventListener("contextmenu", onContextMenu)
      if (autoFocus) live.view.focus()
      onProblemsChangeRef.current?.()
    }

    ;(async () => {
      if (session && session.fileUri !== fileUri) {
        destroyEditorSession(tabId)
        session = null
      }

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
          const pending = consumePendingInitialContent(tabId)
          if (pending != null) {
            initialText = pending
            largeFile = isLargeFile(pending)
          }
        }

        const view = await createJetEditorView({
          parent,
          workspace,
          file,
          initialText,
          largeFile,
          theme,
          lspClient: null,
          executeCommand: runCommand,
          userExtensions,
          onSelectionChange: (line, column) => onEditorSelectionChangeRef.current?.(line, column),
          onDocChange: (doc, meta) => {
            const live = sessionByTab.get(tabId.id)
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
        sessionByTab.set(tabId.id, session)
        viewByTab.set(tabId.id, view)

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
            const live = sessionByTab.get(tabId.id)
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
      if (session && onFocus && onBlur && onContextMenu) {
        session.view.dom.removeEventListener("focus", onFocus)
        session.view.dom.removeEventListener("blur", onBlur)
        session.view.dom.removeEventListener("contextmenu", onContextMenu)
      }
      if (session?.view.dom.parentElement === parent) parent.removeChild(session.view.dom)
      const kind = workspace.tabRegistry.get(tabId)
      if (kind?.kind !== "editor" || kind.fileUri !== fileUri) {
        destroyEditorSession(tabId)
        onProblemsChangeRef.current?.()
      }
    }
  }, [fileUri, tabId.id, workspace])

  useEffect(() => {
    const view = viewByTab.get(tabId.id)
    if (view) applyTheme(view, theme)
  }, [tabId.id, theme])

  useEffect(() => {
    const view = viewByTab.get(tabId.id)
    if (view) applyUserKeymaps(view, keymapBindingsRef.current, runBinding, keymapContextRef.current)
  }, [tabId.id, keymapRevision, runBinding])

  useEffect(() => {
    const view = viewByTab.get(tabId.id)
    if (view) applyUserKeymaps(view, keymapBindingsRef.current, runBinding, keymapContext)
  }, [tabId.id, keymapContext, runBinding])

  useEffect(() => {
    const view = viewByTab.get(tabId.id)
    if (view) applyUserExtensions(view, userExtensions)
  }, [tabId.id, userExtensions])

  useEffect(() => {
    if (!autoFocus) return
    const view = viewByTab.get(tabId.id)
    view?.focus()
  }, [tabId.id, autoFocus])

  useEffect(() => {
    if (lspRevision == null || lspRevision === 0 || !resolveLspClient) return
    const session = sessionByTab.get(tabId.id)
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
  }, [lspRevision, resolveLspClient, fileUri, tabId.id])

  useEffect(() => {
    const sub = workspace.onDidChangeSavedBaseline.event(({ uri, content }) => {
      if (uri !== fileUri) return
      const session = sessionByTab.get(tabId.id)
      if (!session) return
      session.savedBaseline = textFromString(content)
      session.lastKnownText = content
      workspace.markDirty(uri, !session.view.state.doc.eq(session.savedBaseline))
    })
    return () => sub.dispose()
  }, [workspace, fileUri, tabId.id])

  useEffect(() => {
    const sub = workspace.onFileReload.event(({ uri, content }) => {
      if (uri !== fileUri) return
      const session = sessionByTab.get(tabId.id)
      if (!session) return
      session.lastKnownText = content
      session.view.dispatch({
        changes: { from: 0, to: session.view.state.doc.length, insert: content },
        annotations: jetReloadAnnotation.of(true),
      })
      onProblemsChangeRef.current?.()
    })
    return () => sub.dispose()
  }, [workspace, fileUri, tabId.id])

  const activeView = viewByTab.get(tabId.id) ?? null

  return (
    <>
      <div ref={ref} className="h-full w-full overflow-hidden" />
      <EditorContextMenu
        open={contextMenu != null}
        position={contextMenu}
        view={activeView}
        lspAvailable={Boolean(typeof window !== "undefined" && window.jet?.lsp)}
        hasLspPlugin={activeView != null && lspPluginForView(activeView) != null}
        onClose={() => setContextMenu(null)}
        executeCommand={runCommand}
      />
    </>
  )
}

export const EditorTabHost = memo(EditorTabHostInner)
