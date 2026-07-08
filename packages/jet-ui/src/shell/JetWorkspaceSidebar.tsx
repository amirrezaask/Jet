import type { ReactNode } from "react"
import type { WorkspaceManager } from "@jet/workspace"
import type { PanelId } from "@jet/shared"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.js"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar.js"
import { ExplorerTab } from "@/tabs/ExplorerTab.js"
import {
  TerminalExplorerTab,
  type TerminalExplorerGroup,
} from "@/tabs/TerminalExplorerTab.js"

export type JetSidebarView = "explorer" | "terminal-explorer"

export type JetWorkspaceSidebarProps = {
  activeView: JetSidebarView
  onActiveViewChange: (view: JetSidebarView) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultOpen?: boolean
  manager: WorkspaceManager
  onOpenFile: (uri: string, path: string) => void
  terminalExplorerGroups: TerminalExplorerGroup[]
  activeTerminalTabId: string | null
  onFocusTerminal: (panelId: PanelId, tabId: string) => void
  onNewTerminal: (rootUri: string) => void
  onCloseTerminal: (panelId: PanelId, tabId: string) => void
  children: ReactNode
}

export function JetWorkspaceSidebar({
  activeView,
  onActiveViewChange,
  open,
  onOpenChange,
  defaultOpen = true,
  manager,
  onOpenFile,
  terminalExplorerGroups,
  activeTerminalTabId,
  onFocusTerminal,
  onNewTerminal,
  onCloseTerminal,
  children,
}: JetWorkspaceSidebarProps) {
  return (
    <SidebarProvider
      defaultOpen={defaultOpen}
      open={open}
      onOpenChange={onOpenChange}
      className="!min-h-0 h-full min-h-0 w-full"
    >
      <Sidebar collapsible="offcanvas" data-jet-workspace-sidebar>
        <SidebarHeader className="border-b p-2">
          <div className="flex items-center gap-1">
            <SidebarTrigger className="shrink-0" />
            <Tabs
              value={activeView}
              onValueChange={value => onActiveViewChange(value as JetSidebarView)}
              className="min-w-0 flex-1"
            >
              <TabsList className="mx-auto w-fit">
                <TabsTrigger value="explorer">Files</TabsTrigger>
                <TabsTrigger value="terminal-explorer">Terminals</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </SidebarHeader>
        <SidebarContent className="min-h-0 overflow-hidden">
          {activeView === "explorer" ? (
            <ExplorerTab manager={manager} onOpenFile={onOpenFile} />
          ) : (
            <TerminalExplorerTab
              groups={terminalExplorerGroups}
              activeTerminalTabId={activeTerminalTabId}
              onFocusTerminal={onFocusTerminal}
              onNewTerminal={onNewTerminal}
              onCloseTerminal={onCloseTerminal}
            />
          )}
        </SidebarContent>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="min-h-0 overflow-hidden">{children}</SidebarInset>
    </SidebarProvider>
  )
}
