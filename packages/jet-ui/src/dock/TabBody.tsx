import type { TabId } from "@jet/shared"
import type { JetKeyBinding, TabRegistry, WorkspaceService } from "@jet/workspace"
import type { JetTheme } from "@jet/codemirror"
import { EditorTabHost } from "../tabs/EditorTabHost.js"
import { ExplorerTab } from "../tabs/ExplorerTab.js"
import { GitTab } from "../tabs/GitTab.js"
import { TerminalTab } from "../tabs/TerminalTab.js"

export function TabBody({
  tabId,
  registry,
  workspace,
  theme,
  lspTransportUrl,
  executeCommand,
  onOpenFile,
  keymapBindings,
}: {
  tabId: TabId
  registry: TabRegistry
  workspace: WorkspaceService
  theme: JetTheme
  lspTransportUrl?: string | null
  executeCommand: (name: string) => Promise<void>
  onOpenFile: (uri: string, path: string) => void
  keymapBindings: JetKeyBinding[]
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
        />
      )
    case "explorer":
      return <ExplorerTab workspace={workspace} onOpenFile={onOpenFile} />
    case "git":
      return <GitTab workspace={workspace} />
    case "terminal":
      return <TerminalTab />
    default:
      return null
  }
}
