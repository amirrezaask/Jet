import { useEffect, useRef } from "react"
import type { Extension } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import { createJetEditorView, applyUserKeymaps, applyUserExtensions, isLargeFile } from "@jet/codemirror"
import type { JetTheme } from "@jet/codemirror"
import type { KeymapContext, JetKeyBinding, WorkspaceService } from "@jet/workspace"
import type { TabId } from "@jet/shared"
import { fileUriToPath, isUntitledUri } from "@jet/shared"

const viewByTab = new Map<number, EditorView>()

export function getEditorView(tabId: TabId): EditorView | undefined {
  return viewByTab.get(tabId.id)
}

export function EditorTabHost({
  tabId,
  fileUri,
  workspace,
  theme,
  lspTransportUrl,
  executeCommand,
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
  lspTransportUrl?: string | null
  executeCommand: (name: string) => Promise<void>
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
  const keymapContextRef = useRef(keymapContext)
  keymapContextRef.current = keymapContext
  const onEditorFocusChangeRef = useRef(onEditorFocusChange)
  onEditorFocusChangeRef.current = onEditorFocusChange
  const onEditorSelectionChangeRef = useRef(onEditorSelectionChange)
  onEditorSelectionChangeRef.current = onEditorSelectionChange

  const runCommand = useRef((name: string) => executeCommandRef.current(name)).current

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
      const text = untitled ? "" : await workspace.readFile(fileUri)
      if (cancelled) return
      const lspUrl = untitled || isLargeFile(text) ? null : lspTransportUrl
      view = await createJetEditorView({
        parent,
        workspace,
        file,
        initialText: text,
        theme,
        lspTransportUrl: lspUrl,
        executeCommand: runCommand,
        userExtensions,
        onSelectionChange: (line, column) => onEditorSelectionChangeRef.current?.(line, column),
      })
      if (cancelled) {
        view.destroy()
        return
      }
      applyUserKeymaps(view, keymapBindings, runCommand, keymapContextRef.current)
      applyUserExtensions(view, userExtensions)
      viewByTab.set(tabId.id, view)
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
  }, [fileUri, tabId.id, workspace, theme, lspTransportUrl, runCommand])

  useEffect(() => {
    const view = viewByTab.get(tabId.id)
    if (view) applyUserKeymaps(view, keymapBindings, runCommand, keymapContext)
  }, [tabId.id, keymapBindings, runCommand, keymapContext])

  useEffect(() => {
    const view = viewByTab.get(tabId.id)
    if (view) applyUserExtensions(view, userExtensions)
  }, [tabId.id, userExtensions])

  useEffect(() => {
    if (!autoFocus) return
    const view = viewByTab.get(tabId.id)
    view?.focus()
  }, [tabId.id, autoFocus])

  return <div ref={ref} className="h-full w-full overflow-hidden" />
}
