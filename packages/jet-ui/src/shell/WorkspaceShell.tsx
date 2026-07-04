import type { ReactNode } from "react"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable.js"

/**
 * Workspace chrome: persistent explorer (left) + main editor dock (right).
 * Explorer cannot be closed — only resized via the handle or collapsed via SidebarTrigger.
 */
export function WorkspaceShell({
  explorer,
  children,
}: {
  explorer: ReactNode
  children: ReactNode
}) {
  return (
    <ResizablePanelGroup
      id="jet-workspace"
      orientation="horizontal"
      className="h-full w-full min-h-0"
    >
      <ResizablePanel
        id="jet-explorer"
        defaultSize={22}
        minSize={12}
        maxSize={45}
        className="h-full min-h-0 min-w-0"
      >
        <div className="flex h-full min-h-0 w-full flex-col overflow-hidden border-r border-border">
          {explorer}
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel
        id="jet-main"
        defaultSize={78}
        minSize={35}
        className="h-full min-h-0 min-w-0"
      >
        <div
          className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background"
          data-jet-main-panel
        >
          {children}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
