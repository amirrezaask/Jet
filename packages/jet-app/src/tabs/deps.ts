import type { Extension } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import type { AgentProvidersState, AgentThread, AgentWorkspaceSnapshot } from "@jet/agents"
import type { LSPClient, JetTheme } from "@jet/codemirror"
import type {
  JetKeyBinding,
  KeymapContext,
  ListItem,
  WorkspaceService,
} from "@jet/workspace"
import type { AgentExplorerWorkspaceGroup } from "@jet/ui"

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
  getAgentExplorerGroups: () => AgentExplorerWorkspaceGroup[]
  getAgentSnapshot: (rootUri: string) => AgentWorkspaceSnapshot | null
  getAgentThread: (rootUri: string, threadId: string) => AgentThread | null
  getAgentProviders: () => AgentProvidersState | null
  openAgentThread: (rootUri: string, threadId: string) => Promise<void>
  createAgentThread: (rootUri: string, rootPath: string) => Promise<void>
  sendAgentMessage: (
    rootUri: string,
    threadId: string,
    payload: { text: string; provider: string | null; model: string | null },
  ) => Promise<void>
}
