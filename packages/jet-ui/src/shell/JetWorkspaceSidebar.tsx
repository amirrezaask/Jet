import type { WorkspaceManager } from "@jet/workspace"
import type { PanelId } from "@jet/shared"
import { Plus } from "lucide-react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.js"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar.js"
import { Button } from "@/components/ui/button.js"
import { ExplorerTab } from "@/tabs/ExplorerTab.js"
import {
  TerminalExplorerTab,
  type TerminalAgentShortcut,
  type TerminalExplorerGroup,
} from "@/tabs/TerminalExplorerTab.js"

export type JetSidebarView = "explorer" | "terminal-explorer"

export type JetWorkspaceSidebarProps = {
  activeView: JetSidebarView
  onActiveViewChange: (view: JetSidebarView) => void
  manager: WorkspaceManager
  onOpenFile: (uri: string, path: string) => void
  onOpenFolder?: () => void
  onAddWorkspace?: () => void
  terminalExplorerGroups: TerminalExplorerGroup[]
  activeTerminalTabId: string | null
  onFocusTerminal: (panelId: PanelId, tabId: string) => void
  onNewTerminal: (rootUri: string) => void
  onLaunchAgentTerminal: (rootUri: string, shortcut: TerminalAgentShortcut) => void
  onCloseTerminal: (panelId: PanelId, tabId: string) => void
}

function SidebarViewTabs({
  activeView,
  onActiveViewChange,
}: {
  activeView: JetSidebarView
  onActiveViewChange: (view: JetSidebarView) => void
}) {
  return (
    <Tabs
      value={activeView}
      onValueChange={value => {
        if (value === "explorer" || value === "terminal-explorer") {
          onActiveViewChange(value)
        }
      }}
      className="w-full"
    >
      <TabsList
        className="mx-auto w-fit bg-muted p-[3px]"
        aria-label="Sidebar views"
      >
        <TabsTrigger value="explorer" className="h-7 min-w-[4.5rem] px-2.5 text-xs">
          Files
        </TabsTrigger>
        <TabsTrigger value="terminal-explorer" className="h-7 min-w-[4.5rem] px-2.5 text-xs">
          Terminals
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}

export function JetWorkspaceSidebar({
  activeView,
  onActiveViewChange,
  manager,
  onOpenFile,
  onOpenFolder,
  onAddWorkspace,
  terminalExplorerGroups,
  activeTerminalTabId,
  onFocusTerminal,
  onNewTerminal,
  onLaunchAgentTerminal,
  onCloseTerminal,
}: JetWorkspaceSidebarProps) {
  return (
    <Sidebar
      collapsible="none"
      data-jet-workspace-sidebar
      className="h-full border-r border-sidebar-border"
    >
      <SidebarHeader className="shrink-0 border-b border-sidebar-border px-2 py-2">
        <SidebarViewTabs activeView={activeView} onActiveViewChange={onActiveViewChange} />
      </SidebarHeader>
      <SidebarContent className="min-h-0 flex-1 overflow-hidden">
        {activeView === "explorer" ? (
          <ExplorerTab
            manager={manager}
            onOpenFile={onOpenFile}
            onOpenFolder={onOpenFolder}
          />
        ) : (
          <TerminalExplorerTab
            groups={terminalExplorerGroups}
            activeTerminalTabId={activeTerminalTabId}
            onFocusTerminal={onFocusTerminal}
            onNewTerminal={onNewTerminal}
            onLaunchAgentTerminal={onLaunchAgentTerminal}
            onCloseTerminal={onCloseTerminal}
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
