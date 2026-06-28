import { useEffect, useRef } from "react"
import type { EditorView } from "@codemirror/view"
import { createJetEditorView, applyUserKeymaps, isLargeFile } from "@jet/codemirror"
import type { JetTheme } from "@jet/codemirror"
import type { JetKeyBinding, WorkspaceService } from "@jet/workspace"
import type { TabId } from "@jet/shared"
import { fileUriToPath } from "@jet/shared"

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
}: {
  tabId: TabId
  fileUri: string
  workspace: WorkspaceService
  theme: JetTheme
  lspTransportUrl?: string | null
  executeCommand: (name: string) => Promise<void>
  keymapBindings: JetKeyBinding[]
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const parent = ref.current
    if (!parent) return
    let cancelled = false
    let view: EditorView | null = null

    ;(async () => {
      const path = fileUriToPath(fileUri)
      let file = workspace.fileForUri(fileUri)
      if (!file) file = workspace.createWorkspaceFile(fileUri, path)
      const text = await workspace.readFile(fileUri)
      if (cancelled) return
      const lspUrl = isLargeFile(text) ? null : lspTransportUrl
      view = await createJetEditorView({
        parent,
        workspace,
        file,
        initialText: text,
        theme,
        lspTransportUrl: lspUrl,
        executeCommand,
      })
      applyUserKeymaps(view, keymapBindings, executeCommand)
      viewByTab.set(tabId.id, view)
    })()

    return () => {
      cancelled = true
      view?.destroy()
      viewByTab.delete(tabId.id)
    }
  }, [fileUri, tabId.id, workspace, theme, lspTransportUrl, executeCommand, keymapBindings])

  return <div ref={ref} className="h-full w-full overflow-hidden" />
}
