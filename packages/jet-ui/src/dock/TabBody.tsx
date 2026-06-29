import { lazy, memo, Suspense, type ReactNode } from "react"
import type { TabId } from "@jet/shared"
import type { JetProblem } from "@jet/shared"
import { pathToFileUri } from "@jet/shared"
import type { Extension } from "@codemirror/state"
import type { EditorView } from "@codemirror/view"
import type { LSPClient } from "@jet/codemirror"
import type { KeymapContext, JetKeyBinding, TabRegistry, WorkspaceService } from "@jet/workspace"
import type { JetTheme } from "@jet/codemirror"
import { EditorTabHost } from "../tabs/EditorTabHost.js"
import { ExplorerTab } from "../tabs/ExplorerTab.js"

const GitTab = lazy(() => import("../tabs/GitTab.js").then(m => ({ default: m.GitTab })))
const SearchTab = lazy(() => import("../tabs/SearchTab.js").then(m => ({ default: m.SearchTab })))
const ProblemsTab = lazy(() =>
  import("../tabs/ProblemsTab.js").then(m => ({ default: m.ProblemsTab })),
)
const TerminalTab = lazy(() =>
  import("../tabs/TerminalTab.js").then(m => ({ default: m.TerminalTab })),
)

function TabBodyInner({
  tabId,
  registry,
  workspace,
  theme,
  resolveLspClient,
  lspRevision,
  executeCommand,
  runKeyBinding,
  onOpenFile,
  onOpenFileAt,
  onBranchChange,
  problems,
  onOpenProblem,
  keymapBindings,
  userExtensions,
  keymapRevision,
  keymapContext,
  onEditorFocusChange,
  onEditorSelectionChange,
  onGitError,
  autoFocus = false,
}: {
  tabId: TabId
  registry: TabRegistry
  workspace: WorkspaceService
  theme: JetTheme
  resolveLspClient?: (fileUri: string) => Promise<LSPClient | null>
  lspRevision?: number
  executeCommand: (name: string) => Promise<void>
  runKeyBinding: (binding: JetKeyBinding, view?: EditorView) => void
  onOpenFile: (uri: string, path: string) => void
  onOpenFileAt: (uri: string, path: string, line: number, column: number) => void
  onBranchChange?: (branch: string | null) => void
  problems: JetProblem[]
  onOpenProblem: (problem: JetProblem) => void
  keymapBindings: JetKeyBinding[]
  userExtensions: Extension[]
  keymapRevision: number
  keymapContext?: KeymapContext
  onEditorFocusChange?: (focused: boolean) => void
  onEditorSelectionChange?: (line: number, column: number) => void
  onGitError?: (message: string) => void
  autoFocus?: boolean
}) {
  const kind = registry.get(tabId)
  if (!kind) return null

  const suspense = (label: string, node: ReactNode) => (
    <Suspense
      fallback={<div className="p-3 text-xs text-[var(--jet-text-muted)]">Loading {label}…</div>}
    >
      {node}
    </Suspense>
  )

  switch (kind.kind) {
    case "editor":
      return (
        <EditorTabHost
          tabId={tabId}
          fileUri={kind.fileUri}
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
          autoFocus={autoFocus}
        />
      )
    case "explorer":
      return <ExplorerTab workspace={workspace} onOpenFile={onOpenFile} />
    case "git":
      return suspense(
        "git view",
        <GitTab workspace={workspace} onBranchChange={onBranchChange} onGitError={onGitError} />,
      )
    case "terminal":
      return suspense("terminal", <TerminalTab workspace={workspace} theme={theme} />)
    case "search":
      return suspense(
        "search",
        <SearchTab
          workspace={workspace}
          onFindInEditor={() => executeCommand("editor.find")}
          onOpenResult={(path, line, column) => {
            if (!workspace.root) return
            const fullPath = `${workspace.root.path}/${path.replace(/^\/+/, "")}`
            onOpenFileAt(pathToFileUri(fullPath), fullPath, line, column)
          }}
        />,
      )
    case "problems":
      return suspense(
        "problems",
        <ProblemsTab problems={problems} onOpenProblem={onOpenProblem} />,
      )
    default:
      return null
  }
}

export const TabBody = memo(TabBodyInner)
