import type { Extension } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import type { LSPClient, GharargahTheme } from "@gharargah/codemirror"
import type {
  JetKeyBinding,
  KeymapContext,
  WorkspaceService,
} from "@gharargah/workspace"
import type { PanelId } from "@gharargah/shared"

/**
 * Ambient dependencies threaded into contributor tab types when they are
 * registered at app boot.
 */
export type TabContributorDeps = {
  workspace: WorkspaceService
  getTheme: () => GharargahTheme
  resolveLspClient: (fileUri: string) => Promise<LSPClient | null>
  getLspRevision: () => number
  executeCommand: (name: string) => Promise<void>
  runKeyBinding: (binding: JetKeyBinding, view?: EditorView) => void
  getKeymapBindings: () => JetKeyBinding[]
  getUserExtensions: () => Extension[]
  getKeymapRevision: () => number
  getKeymapContext: () => KeymapContext | undefined
  onEditorFocusChange: (focused: boolean) => void
  onEditorSelectionChange: (line: number, column: number, rangeCount: number) => void
  onLspAttachFailed: (fileUri: string) => void
  onProblemsChange: () => void
  closeTerminalTab: (panelId: PanelId, tabId: string) => void
  onTerminalTitleChange: (tabId: string, title: string) => void
}
