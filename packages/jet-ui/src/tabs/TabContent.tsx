import type { Extension } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import type { LSPClient, JetTheme } from "@jet/codemirror"
import type { KeymapContext, JetKeyBinding, ListItem, WorkspaceService } from "@jet/workspace"
import type { PanelId } from "@jet/shared"
import { EditorTabHost } from "../tabs/EditorTabHost.js"
import { ExplorerTab } from "../tabs/ExplorerTab.js"
import { ListPanelBody } from "../panels/location-list/index.js"
import { OutputPanel } from "../panels/OutputPanel.js"

export function TabContent({
  tabId,
  panelId,
  workspace,
  theme,
  resolveLspClient,
  lspRevision,
  executeCommand,
  runKeyBinding,
  onOpenFile,
  onOpenListItem,
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
  tabId: string
  panelId: PanelId
  workspace: WorkspaceService
  theme: JetTheme
  resolveLspClient?: (fileUri: string) => Promise<LSPClient | null>
  lspRevision?: number
  executeCommand: (name: string) => Promise<void>
  runKeyBinding: (binding: JetKeyBinding, view?: EditorView) => void
  onOpenFile: (uri: string, path: string) => void
  onOpenListItem: (item: ListItem) => void
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
  const tab = workspace.tabRegistry.get(tabId)
  if (!tab) return null

  switch (tab.kind) {
    case "editor":
      return (
        <EditorTabHost
          panelId={panelId}
          fileUri={tabId}
          workspace={workspace}
          theme={theme}
          resolveLspClient={resolveLspClient}
          lspRevision={lspRevision}
          executeCommand={executeCommand}
          runKeyBinding={runKeyBinding}
          keymapBindings={keymapBindings}
          userExtensions={userExtensions}
          keymapRevision={keymapRevision}
          keymapContext={keymapContext}
          onEditorFocusChange={onEditorFocusChange}
          onEditorSelectionChange={onEditorSelectionChange}
          onLspAttachFailed={onLspAttachFailed}
          onProblemsChange={onProblemsChange}
          autoFocus={autoFocus}
        />
      )
    case "explorer":
      return (
        <div className="h-full min-h-0">
          <ExplorerTab workspace={workspace} onOpenFile={onOpenFile} />
        </div>
      )
    case "output":
      return <OutputPanel workspace={workspace} />
    case "search":
    case "problems":
    case "references":
    case "definitions":
    case "task-errors":
      return (
        <div className="flex h-full min-h-0 flex-col">
          <ListPanelBody listId={tabId} workspace={workspace} onOpenItem={onOpenListItem} />
        </div>
      )
    default:
      return null
  }
}
