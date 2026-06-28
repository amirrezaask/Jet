import { useEffect, useRef } from "react"
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
  reconfigureLsp,
} from "@jet/codemirror"
import type { JetTheme } from "@jet/codemirror"
import type { KeymapContext, JetKeyBinding, TabRegistry, WorkspaceService } from "@jet/workspace"
import type { TabId } from "@jet/shared"
import { fileUriToPath, isUntitledUri } from "@jet/shared"

const viewByTab = new Map<number, EditorView>()

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

export function EditorTabHost({
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
  keymapContext,
  onEditorFocusChange,
  onEditorSelectionChange,
  autoFocus = false,
}: {
  tabId: TabId
  fileUri: string
  workspace: WorkspaceService
  theme: JetTheme
  resolveLspClient?: (fileUri: string) => Promise<LSPClient | null>
  lspRevision?: number
  executeCommand: (name: string) => Promise<void>
  runKeyBinding: (binding: JetKeyBinding) => void
  keymapBindings: JetKeyBinding[]
  userExtensions: Extension[]
  keymapContext?: KeymapContext
  onEditorFocusChange?: (focused: boolean) => void
  onEditorSelectionChange?: (line: number, column: number) => void
  autoFocus?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const executeCommandRef = useRef(executeCommand)
  executeCommandRef.current = executeCommand
  const runKeyBindingRef = useRef(runKeyBinding)
  runKeyBindingRef.current = runKeyBinding
  const keymapContextRef = useRef(keymapContext)
  keymapContextRef.current = keymapContext
  const onEditorFocusChangeRef = useRef(onEditorFocusChange)
  onEditorFocusChangeRef.current = onEditorFocusChange
  const onEditorSelectionChangeRef = useRef(onEditorSelectionChange)
  onEditorSelectionChangeRef.current = onEditorSelectionChange
  const resolveLspClientRef = useRef(resolveLspClient)
  resolveLspClientRef.current = resolveLspClient
  const fileLanguageIdRef = useRef("plaintext")

  const runCommand = useRef((name: string) => executeCommandRef.current(name)).current
  const runBinding = useRef((binding: JetKeyBinding) => runKeyBindingRef.current(binding)).current

  useEffect(() => {
    const parent = ref.current
    if (!parent) return
    let cancelled = false
    let view: EditorView | null = null
    let onFocus: (() => void) | null = null
    let onBlur: (() => void) | null = null

    ;(async () => {
      const untitled = isUntitledUri(fileUri)
      const path = untitled ? "" : fileUriToPath(fileUri)
      let file = workspace.fileForUri(fileUri)
      if (!file) file = workspace.createWorkspaceFile(fileUri, path)
      fileLanguageIdRef.current = file.languageId
      const text = untitled ? "" : await workspace.readFile(fileUri)
      if (cancelled) return
      let lspClient: LSPClient | null = null
      if (!untitled && !isLargeFile(text) && resolveLspClientRef.current) {
        lspClient = await resolveLspClientRef.current(fileUri)
      }
      if (cancelled) return
      view = await createJetEditorView({
        parent,
        workspace,
        file,
        initialText: text,
        theme,
        lspClient,
        executeCommand: runCommand,
        userExtensions,
        onSelectionChange: (line, column) => onEditorSelectionChangeRef.current?.(line, column),
      })
      if (cancelled) {
        view.destroy()
        return
      }
      applyUserKeymaps(view, keymapBindings, runBinding, keymapContextRef.current)
      applyUserExtensions(view, userExtensions)
      viewByTab.set(tabId.id, view)
      const nav = consumePendingEditorNavigation(tabId)
      if (nav) jumpToLine(view, nav.line, nav.column)
      onFocus = () => onEditorFocusChangeRef.current?.(true)
      onBlur = () => onEditorFocusChangeRef.current?.(false)
      view.dom.addEventListener("focus", onFocus)
      view.dom.addEventListener("blur", onBlur)
      if (autoFocus) view.focus()
    })()

    return () => {
      cancelled = true
      if (view && onFocus && onBlur) {
        view.dom.removeEventListener("focus", onFocus)
        view.dom.removeEventListener("blur", onBlur)
      }
      view?.destroy()
      viewByTab.delete(tabId.id)
    }
  }, [fileUri, tabId.id, workspace, theme, runCommand])

  useEffect(() => {
    if (lspRevision == null || !resolveLspClient) return
    const view = viewByTab.get(tabId.id)
    if (!view) return
    let cancelled = false
    ;(async () => {
      const client = await resolveLspClient(fileUri)
      if (cancelled || !client) return
      await reconfigureLsp(view, fileUri, fileLanguageIdRef.current, client)
    })()
    return () => {
      cancelled = true
    }
  }, [lspRevision, resolveLspClient, fileUri, tabId.id])

  useEffect(() => {
    const view = viewByTab.get(tabId.id)
    if (view) applyUserKeymaps(view, keymapBindings, runBinding, keymapContext)
  }, [tabId.id, keymapBindings, runBinding, keymapContext])

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
      })
    })
    return () => sub.dispose()
  }, [workspace, fileUri, tabId.id])

  return <div ref={ref} className="h-full w-full overflow-hidden" />
}
