import { lazy, Suspense } from "react"
import type { TabId } from "@jet/shared"
import type { Extension } from "@codemirror/state"
import type { KeymapContext, JetKeyBinding, TabRegistry, WorkspaceService } from "@jet/workspace"
import type { JetTheme } from "@jet/codemirror"
import { EditorTabHost } from "../tabs/EditorTabHost.js"
import { ExplorerTab } from "../tabs/ExplorerTab.js"
import { TerminalTab } from "../tabs/TerminalTab.js"
import { SearchTab } from "../tabs/SearchTab.js"
import { ProblemsTab } from "../tabs/ProblemsTab.js"

const GitTab = lazy(() => import("../tabs/GitTab.js").then(m => ({ default: m.GitTab })))

export function TabBody({
  tabId,
  registry,
  workspace,
  theme,
  lspTransportUrl,
  executeCommand,
  onOpenFile,
  keymapBindings,
  userExtensions,
  keymapContext,
  onEditorFocusChange,
  onEditorSelectionChange,
  autoFocus = false,
}: {
  tabId: TabId
  registry: TabRegistry
  workspace: WorkspaceService
  theme: JetTheme
  lspTransportUrl?: string | null
  executeCommand: (name: string) => Promise<void>
  onOpenFile: (uri: string, path: string) => void
  keymapBindings: JetKeyBinding[]
  userExtensions: Extension[]
  keymapContext?: KeymapContext
  onEditorFocusChange?: (focused: boolean) => void
  onEditorSelectionChange?: (line: number, column: number) => void
  autoFocus?: boolean
}) {
  const kind = registry.get(tabId)
  if (!kind) return null

  switch (kind.kind) {
    case "editor":
      return (
        <EditorTabHost
          tabId={tabId}
          fileUri={kind.fileUri}
          workspace={workspace}
          theme={theme}
          lspTransportUrl={lspTransportUrl}
          executeCommand={executeCommand}
          keymapBindings={keymapBindings}
          userExtensions={userExtensions}
          keymapContext={keymapContext}
          onEditorFocusChange={onEditorFocusChange}
          onEditorSelectionChange={onEditorSelectionChange}
          autoFocus={autoFocus}
        />
      )
    case "explorer":
      return <ExplorerTab workspace={workspace} onOpenFile={onOpenFile} />
    case "git":
      return (
        <Suspense
          fallback={
            <div className="p-3 text-xs text-[var(--jet-text-muted)]">Loading git view…</div>
          }
        >
          <GitTab workspace={workspace} />
        </Suspense>
      )
    case "terminal":
      return <TerminalTab />
    case "search":
      return <SearchTab onFindInEditor={() => executeCommand("editor.find")} />
    case "problems":
      return <ProblemsTab />
    default:
      return null
  }
}
