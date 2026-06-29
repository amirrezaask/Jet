import { memo, useEffect, useRef, useState } from "react"
import type { Extension } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import type { LSPClient } from "@jet/codemirror"
import {
  createJetEditorView,
  applyUserKeymaps,
  applyUserExtensions,
  isLargeFile,
  jumpToLine,
  consumePendingEditorNavigation,
  consumePendingInitialContent,
  reconfigureLsp,
  detachLsp,
  lspPluginForView,
  jetReloadAnnotation,
} from "@jet/codemirror"
import type { JetTheme } from "@jet/codemirror"
import type { KeymapContext, JetKeyBinding, TabRegistry, WorkspaceService } from "@jet/workspace"
import type { TabId } from "@jet/shared"
import { fileUriToPath, isUntitledUri } from "@jet/shared"
import {
  EditorContextMenu,
  registerEditorContextMenuHandler,
} from "../components/EditorContextMenu.js"

const viewByTab = new Map<number, EditorView>()
let focusedTabId: number | null = null

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
    if (kind?.kind === "editor" && view) {
      result.push({ tabId, uri: kind.fileUri, view })
    }
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
  const fileLanguageIdRef = useRef("plaintext")
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
    let view: EditorView | null = null
    let onFocus: (() => void) | null = null
    let onBlur: (() => void) | null = null
    let onContextMenu: ((e: MouseEvent) => void) | null = null

    ;(async () => {
      const untitled = isUntitledUri(fileUri)
      const path = untitled ? "" : fileUriToPath(fileUri)
      let file = workspace.fileForUri(fileUri)
      if (!file) file = workspace.createWorkspaceFile(fileUri, path)
      fileLanguageIdRef.current = file.languageId

      let initialText = ""
      let largeFile = false
      if (!untitled) {
        const text = await workspace.readFile(fileUri)
        if (cancelled) return
        initialText = text
        largeFile = isLargeFile(text)
      } else {
        const pending = consumePendingInitialContent(tabId)
        if (pending != null) {
          initialText = pending
          largeFile = isLargeFile(pending)
          workspace.markDirty(fileUri, true)
        }
      }

      view = await createJetEditorView({
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
      })
      if (cancelled) {
        view.destroy()
        return
      }
      applyUserKeymaps(view, keymapBindingsRef.current, runBinding, keymapContextRef.current)
      applyUserExtensions(view, userExtensions)
      viewByTab.set(tabId.id, view)
      const nav = consumePendingEditorNavigation(tabId)
      if (nav) jumpToLine(view, nav.line, nav.column)
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
      view.dom.addEventListener("focus", onFocus)
      view.dom.addEventListener("blur", onBlur)
      view.dom.addEventListener("contextmenu", onContextMenu)
      if (autoFocus) view.focus()

      if (!largeFile && !untitled && resolveLspClientRef.current) {
        void (async () => {
          const client = await resolveLspClientRef.current!(fileUri)
          if (cancelled) return
          if (!client) {
            onLspAttachFailedRef.current?.(fileUri)
            return
          }
          const live = viewByTab.get(tabId.id)
          if (!live) return
          await reconfigureLsp(live, fileUri, fileLanguageIdRef.current, client)
        })()
      }
    })()

    return () => {
      cancelled = true
      if (view && onFocus && onBlur && onContextMenu) {
        view.dom.removeEventListener("focus", onFocus)
        view.dom.removeEventListener("blur", onBlur)
        view.dom.removeEventListener("contextmenu", onContextMenu)
      }
      if (view) detachLsp(view)
      view?.destroy()
      viewByTab.delete(tabId.id)
      if (focusedTabId === tabId.id) focusedTabId = null
    }
  }, [fileUri, tabId.id, workspace, theme, runCommand, userExtensions, autoFocus])

  useEffect(() => {
    if (lspRevision == null || lspRevision === 0 || !resolveLspClient) return
    const view = viewByTab.get(tabId.id)
    if (!view) return
    let cancelled = false
    ;(async () => {
      const client = await resolveLspClient(fileUri)
      if (cancelled) return
      if (!client) {
        onLspAttachFailedRef.current?.(fileUri)
        return
      }
      await reconfigureLsp(view, fileUri, fileLanguageIdRef.current, client)
    })()
    return () => {
      cancelled = true
    }
  }, [lspRevision, resolveLspClient, fileUri, tabId.id])

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
    const sub = workspace.onFileReload.event(({ uri, content }) => {
      if (uri !== fileUri) return
      const view = viewByTab.get(tabId.id)
      if (!view) return
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
        annotations: jetReloadAnnotation.of(true),
      })
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
