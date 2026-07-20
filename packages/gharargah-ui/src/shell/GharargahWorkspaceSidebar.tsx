import type { CSSProperties } from "react"
import type { WorkspaceManager } from "@gharargah/workspace"
import type { PanelId } from "@gharargah/shared"
import { Plus } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar.js"
import { Button } from "@/components/ui/button.js"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.js"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip.js"
import { ExplorerTab } from "@/tabs/ExplorerTab.js"
import {
  TerminalExplorerTab,
  type TerminalAgentShortcut,
  type TerminalExplorerGroup,
} from "@/tabs/TerminalExplorerTab.js"

export type JetSidebarView = "explorer" | "terminal-explorer"

export type GharargahWorkspaceSidebarProps = {
  activeView: JetSidebarView
  onActiveViewChange: (view: JetSidebarView) => void
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
  /** macOS Overlay chrome: traffic-light clearance + drag on this header. */
  showWindowChrome?: boolean
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
      data-gharargah-sidebar-view-tabs
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

export function GharargahWorkspaceSidebar({
  activeView,
  onActiveViewChange,
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
  showWindowChrome = false,
}: GharargahWorkspaceSidebarProps) {
  const { state } = useSidebar()
  return (
    <Sidebar
      data-gharargah-workspace-sidebar
      data-gharargah-sidebar-state={state}
      aria-hidden={state === "collapsed" ? true : undefined}
      className="h-full border-r border-sidebar-border"
      onFocusCapture={() => onSidebarFocusChange?.(true)}
      onBlurCapture={e => {
        const next = e.relatedTarget
        if (next instanceof Node && e.currentTarget.contains(next)) return
        onSidebarFocusChange?.(false)
      }}
    >
      <div
        data-gharargah-sidebar-chrome
        data-tauri-drag-region={showWindowChrome ? "deep" : undefined}
        className="flex min-h-[var(--gharargah-window-chrome-height)] shrink-0 items-stretch border-b border-sidebar-border px-2"
        style={
          showWindowChrome ? ({ WebkitAppRegion: "drag" } as CSSProperties) : undefined
        }
      >
        {showWindowChrome ? (
          <div
            aria-hidden
            data-gharargah-traffic-light-spacer
            data-tauri-drag-region="true"
            className="shrink-0 self-stretch"
            style={{ WebkitAppRegion: "drag" } as CSSProperties}
          />
        ) : null}
        <div
          className="flex min-w-0 flex-1 items-center gap-1 py-1 pl-1"
          data-tauri-drag-region={showWindowChrome ? "false" : undefined}
          style={
            showWindowChrome ? ({ WebkitAppRegion: "no-drag" } as CSSProperties) : undefined
          }
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <SidebarTrigger
                data-gharargah-sidebar-toggle
                className="size-7 shrink-0 text-sidebar-foreground"
              />
            </TooltipTrigger>
            <TooltipContent side="bottom">Toggle Sidebar</TooltipContent>
          </Tooltip>
          <JetSidebarViewTabs
            activeView={activeView}
            onActiveViewChange={onActiveViewChange}
          />
        </div>
      </div>
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
