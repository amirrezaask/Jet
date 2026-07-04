import { useCallback, useRef, type FocusEvent } from "react"
import type { WorkspaceService } from "@jet/workspace"
import { SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar.js"
import { ExplorerTree } from "../tabs/ExplorerTab.js"

/** Focus the persistent explorer and expand it when collapsed to icon rail. */
export function focusExplorerPanel(): void {
  const root = document.querySelector("[data-jet-explorer-panel]")
  if (!(root instanceof HTMLElement)) return

  const collapsed = root.querySelector('[data-jet-explorer-shell][data-state="collapsed"]')
  if (collapsed) {
    root.querySelector<HTMLElement>('[data-sidebar="trigger"]')?.click()
  }

  root.focus()
  root.querySelector<HTMLElement>('[data-jet-list-panel="explorer"]')?.focus()
}

function ExplorerPanelHeader() {
  const { state } = useSidebar()
  return (
    <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border bg-muted/50 px-1">
      <SidebarTrigger className="size-7" />
      {state === "expanded" ? (
        <span className="min-w-0 flex-1 truncate text-xs uppercase tracking-wide text-muted-foreground">
          Explorer
        </span>
      ) : (
        <span className="sr-only">Explorer</span>
      )}
    </div>
  )
}

function ExplorerTreeShell({ children }: { children: React.ReactNode }) {
  const { state } = useSidebar()
  return (
    <div
      data-jet-explorer-shell
      data-state={state}
      data-collapsible={state === "collapsed" ? "icon" : ""}
      data-side="left"
      className="group min-h-0 flex-1 overflow-hidden"
    >
      {children}
    </div>
  )
}

export function ExplorerPanel({
  workspace,
  onOpenFile,
  onFocusChange,
}: {
  workspace: WorkspaceService
  onOpenFile: (uri: string, path: string) => void
  onFocusChange?: (focused: boolean) => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  const handleFocusIn = useCallback(() => {
    onFocusChange?.(true)
  }, [onFocusChange])

  const handleFocusOut = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      const next = event.relatedTarget
      if (next instanceof Node && panelRef.current?.contains(next)) return
      onFocusChange?.(false)
    },
    [onFocusChange],
  )

  if (!workspace.root) return null

  return (
    <SidebarProvider className="!min-h-0 flex h-full w-full min-h-0 flex-col">
      <div
        ref={panelRef}
        data-jet-explorer-panel
        className="flex h-full min-h-0 w-full flex-col overflow-hidden outline-none"
        tabIndex={-1}
        onFocusCapture={handleFocusIn}
        onBlurCapture={handleFocusOut}
      >
        <ExplorerPanelHeader />
        <ExplorerTreeShell>
          <ExplorerTree workspace={workspace} onOpenFile={onOpenFile} />
        </ExplorerTreeShell>
      </div>
    </SidebarProvider>
  )
}
