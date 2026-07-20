import type { Extension } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import type { AgentProvidersState, AgentThread, AgentWorkspaceSnapshot } from "@gharargah/agents"
import type { LSPClient, GharargahTheme } from "@gharargah/codemirror"
import type {
  JetKeyBinding,
  KeymapContext,
  ListItem,
  WorkspaceService,
} from "@gharargah/workspace"
import type {
  TerminalAgentShortcut,
  TerminalExplorerGroup,
} from "@gharargah/ui"
import type { AgentExplorerWorkspaceGroup } from "@gharargah/ui/agents"
import type { PanelId } from "@gharargah/shared"

/**
 * Ambient dependencies threaded into contributor tab types when they are
 * registered at app boot. Individual TabType.render closures capture whichever
 * fields they need; the framework is unaware of these.
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
  onOpenFile: (uri: string, path: string) => void
  onOpenListItem: (item: ListItem) => void
  /** Scope project search to the current tab's workspace. */
  getSearchFolders: () => import("@gharargah/workspace").WorkspaceFolder[]
  getAgentExplorerGroups: () => AgentExplorerWorkspaceGroup[]
  getAgentSnapshot: (rootUri: string) => AgentWorkspaceSnapshot | null
  getAgentThread: (rootUri: string, threadId: string) => AgentThread | null
  subscribeAgentThread: (
    rootUri: string,
    threadId: string,
    listener: (thread: AgentThread | null) => void,
  ) => () => void
  getAgentProviders: () => AgentProvidersState | null
  refreshAgentProviders: () => Promise<AgentProvidersState | null>
  updateAgentThreadSettings: (
    rootUri: string,
    threadId: string,
    settings: { provider?: string | null; model?: string | null },
  ) => Promise<void>
  openAgentThread: (rootUri: string, threadId: string) => Promise<void>
  createAgentThread: (rootUri: string, rootPath: string) => Promise<void>
  sendAgentMessage: (
    rootUri: string,
    threadId: string,
    payload: { text: string; provider: string | null; model: string | null },
  ) => Promise<void>
  interruptAgentTurn: (rootUri: string, threadId: string) => Promise<void>
  archiveAgentThread: (rootUri: string, rootPath: string, threadId: string) => Promise<void>
  unarchiveAgentThread: (rootUri: string, rootPath: string, threadId: string) => Promise<void>
  getTerminalExplorerGroups: () => TerminalExplorerGroup[]
  focusTerminalTab: (panelId: PanelId, tabId: string) => void
  newTerminalInWorkspace: (rootUri: string) => Promise<void>
  launchAgentTerminal: (rootUri: string, shortcut: TerminalAgentShortcut) => void
  closeTerminalTab: (panelId: PanelId, tabId: string) => void
  getActiveTerminalTabId: () => string | null
  onTerminalTitleChange: (tabId: string, title: string) => void
}
