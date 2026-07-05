import { memo } from "react"
import type { PanelId, PanelView } from "@jet/shared"
import type { Extension } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import type { LSPClient } from "@jet/codemirror"
import type { KeymapContext, JetKeyBinding, ListItem, WorkspaceService } from "@jet/workspace"
import type { JetTheme } from "@jet/codemirror"
import { SidebarProvider } from "@/components/ui/sidebar.js"
import { TabContent } from "../tabs/TabContent.js"
import { PanelEmptyState } from "./PanelEmptyState.js"

function PanelBodyInner({
  panelId,
  view,
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
  panelId: PanelId
  view: PanelView
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
  if (view.kind === "empty") {
    return <PanelEmptyState />
  }

  return (
    <SidebarProvider className="!min-h-0 flex h-full min-h-0 flex-1 flex-col text-sidebar-foreground">
      <TabContent
        tabId={view.activeTabId}
        panelId={panelId}
        workspace={workspace}
        theme={theme}
        resolveLspClient={resolveLspClient}
        lspRevision={lspRevision}
        executeCommand={executeCommand}
        runKeyBinding={runKeyBinding}
        onOpenFile={onOpenFile}
        onOpenListItem={onOpenListItem}
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
    </SidebarProvider>
  )
}

export const PanelBody = memo(PanelBodyInner)
