import type { WorkspaceManager } from "@jet/workspace"
import type { PanelId } from "@jet/shared"
import { Plus } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
} from "@/components/ui/sidebar.js"
import { Button } from "@/components/ui/button.js"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.js"
import { ExplorerTab } from "@/tabs/ExplorerTab.js"
import {
  TerminalExplorerTab,
  type TerminalAgentShortcut,
  type TerminalExplorerGroup,
} from "@/tabs/TerminalExplorerTab.js"

export type JetSidebarView = "explorer" | "terminal-explorer"

export type JetWorkspaceSidebarProps = {
  activeView: JetSidebarView
  manager: WorkspaceManager
  onOpenFile: (uri: string, path: string) => void
  onOpenFolder?: () => void
  onAddWorkspace?: () => void
  terminalExplorerGroups: TerminalExplorerGroup[]
  activeProjectRootUri: string | null
  activeTerminalTabId: string | null
  onActivateProject: (rootUri: string) => void
  onFocusTerminal: (panelId: PanelId, tabId: string) => void
  onNewTerminal: (rootUri: string) => void
  onLaunchAgentTerminal: (rootUri: string, shortcut: TerminalAgentShortcut) => void
  onCloseTerminal: (panelId: PanelId, tabId: string) => void
  onRenameTerminal: (tabId: string, label: string) => void
  onDuplicateTerminal: (tabId: string) => void
  onRestartTerminal: (tabId: string) => void
  onRemoveProject: (rootUri: string) => void
  onSidebarFocusChange?: (focused: boolean) => void
}

export function JetSidebarViewTabs({
  activeView,
  onActiveViewChange,
}: {
  activeView: JetSidebarView
  onActiveViewChange: (view: JetSidebarView) => void
}) {
  return (
    <Tabs
      data-jet-titlebar-tabs
      value={activeView}
      onValueChange={value => onActiveViewChange(value as JetSidebarView)}
      aria-label="Sidebar views"
      className="min-w-0 flex-1"
    >
      <TabsList variant="line" className="w-full">
        <TabsTrigger value="explorer">Files</TabsTrigger>
        <TabsTrigger value="terminal-explorer">Terminals</TabsTrigger>
      </TabsList>
    </Tabs>
  )
}

export function JetWorkspaceSidebar({
  activeView,
  manager,
  onOpenFile,
  onOpenFolder,
  onAddWorkspace,
  terminalExplorerGroups,
  activeProjectRootUri,
  activeTerminalTabId,
  onActivateProject,
  onFocusTerminal,
  onNewTerminal,
  onLaunchAgentTerminal,
  onCloseTerminal,
  onRenameTerminal,
  onDuplicateTerminal,
  onRestartTerminal,
  onRemoveProject,
  onSidebarFocusChange,
}: JetWorkspaceSidebarProps) {
  return (
    <Sidebar
      collapsible="none"
      data-jet-workspace-sidebar
      className="h-full border-r border-sidebar-border"
      onFocusCapture={() => onSidebarFocusChange?.(true)}
      onBlurCapture={e => {
        const next = e.relatedTarget
        if (next instanceof Node && e.currentTarget.contains(next)) return
        onSidebarFocusChange?.(false)
      }}
    >
      <SidebarContent className="min-h-0 flex-1 overflow-hidden">
        {activeView === "explorer" ? (
          <ExplorerTab
            manager={manager}
            onOpenFile={onOpenFile}
            onOpenFolder={onOpenFolder}
            onActivateProject={onActivateProject}
            onNewTerminal={onNewTerminal}
            onRemoveProject={onRemoveProject}
          />
        ) : (
          <TerminalExplorerTab
            groups={terminalExplorerGroups}
            activeProjectRootUri={activeProjectRootUri}
            activeTerminalTabId={activeTerminalTabId}
            onActivateProject={onActivateProject}
            onFocusTerminal={onFocusTerminal}
            onNewTerminal={onNewTerminal}
            onLaunchAgentTerminal={onLaunchAgentTerminal}
            onCloseTerminal={onCloseTerminal}
            onRenameTerminal={onRenameTerminal}
            onDuplicateTerminal={onDuplicateTerminal}
            onRestartTerminal={onRestartTerminal}
            onRemoveProject={onRemoveProject}
            onOpenFolder={onOpenFolder}
          />
        )}
      </SidebarContent>
      {onAddWorkspace ? (
        <SidebarFooter className="shrink-0 border-t border-sidebar-border px-2 py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onAddWorkspace}
            className="w-full justify-start gap-2 text-xs font-medium text-sidebar-foreground"
          >
            <Plus className="size-3.5" />
            Add workspace
          </Button>
        </SidebarFooter>
      ) : null}
    </Sidebar>
  )
}
