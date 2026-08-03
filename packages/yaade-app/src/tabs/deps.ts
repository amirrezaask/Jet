import type { YaadeTheme } from "@yaade/shared"
import type { LspClientHandle } from "@yaade/lsp"
import type { MonacoEditorHandle } from "@yaade/monaco"
import type {
  JetKeyBinding,
  KeymapContext,
  WorkspaceService,
} from "@yaade/workspace"
import type { PanelId } from "@yaade/shared"

/**
 * Ambient dependencies threaded into contributor tab types when they are
 * registered at app boot.
 */
export type TabContributorDeps = {
  workspace: WorkspaceService
  getTheme: () => YaadeTheme
  resolveLspClient: (fileUri: string) => Promise<LspClientHandle | null>
  getLspRevision: () => number
  executeCommand: (name: string) => Promise<void>
  runKeyBinding: (binding: JetKeyBinding, view?: MonacoEditorHandle) => void
  getKeymapBindings: () => JetKeyBinding[]
  getUserExtensions: () => unknown[]
  getKeymapRevision: () => number
  getKeymapContext: () => KeymapContext | undefined
  onEditorFocusChange: (focused: boolean) => void
  onEditorSelectionChange: (line: number, column: number, rangeCount: number) => void
  onLspAttachFailed: (fileUri: string) => void
  onProblemsChange: () => void
  closeTerminalTab: (panelId: PanelId, tabId: string) => void
  onTerminalTitleChange: (tabId: string, title: string) => void
  onOpenPath?: (cwdRootUri: string, path: string, line?: number, column?: number) => void
}
