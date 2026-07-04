import { memo, type ReactNode } from "react"
import type { PanelId, PanelView } from "@jet/shared"
import type { Extension } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import type { LSPClient } from "@jet/codemirror"
import type { KeymapContext, JetKeyBinding, WorkspaceService } from "@jet/workspace"
import type { LocationItem } from "@jet/workspace"
import type { JetTheme } from "@jet/codemirror"
import { EditorTabHost } from "../tabs/EditorTabHost.js"
import { ExplorerTab } from "../tabs/ExplorerTab.js"
import { LocationListPanel } from "../panels/LocationListPanel.js"
import { OutputPanel } from "../panels/OutputPanel.js"
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
  onOpenLocationItem,
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
  onOpenLocationItem: (item: LocationItem) => void
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
  switch (view.kind) {
    case "empty":
      return <PanelEmptyState />
    case "editor":
      return (
        <EditorTabHost
          panelId={panelId}
          fileUri={view.fileUri}
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
    case "locationlist":
      return <LocationListPanel workspace={workspace} onOpenItem={onOpenLocationItem} />
    case "output":
      return <OutputPanel workspace={workspace} />
    default:
      return null
  }
}

export const PanelBody = memo(PanelBodyInner)
