import type { Extension } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import type { LSPClient, JetTheme } from "@jet/codemirror"
import type {
  JetKeyBinding,
  KeymapContext,
  ListItem,
  WorkspaceService,
} from "@jet/workspace"

/**
 * Ambient dependencies threaded into contributor tab types when they are
 * registered at app boot. Individual TabType.render closures capture whichever
 * fields they need; the framework is unaware of these.
 */
export type TabContributorDeps = {
  workspace: WorkspaceService
  getTheme: () => JetTheme
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
  onOpenFile: (uri: string, path: string) => void
  onOpenListItem: (item: ListItem) => void
}
