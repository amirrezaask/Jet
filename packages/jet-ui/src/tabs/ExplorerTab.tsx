import { useCallback, useEffect, useState } from "react"
import { ChevronRight, File, Folder } from "lucide-react"
import type { WorkspaceEntry, WorkspaceService } from "@jet/workspace"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible.js"
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar.js"

function sortEntries(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return entries
    .filter(e => !e.name.startsWith("."))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

function ExplorerTreeNode({
  entry,
  workspace,
  onOpenFile,
  nested = false,
  defaultOpen = false,
}: {
  entry: WorkspaceEntry
  workspace: WorkspaceService
  onOpenFile: (uri: string, path: string) => void
  nested?: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [children, setChildren] = useState<WorkspaceEntry[] | null>(null)
  const [loading, setLoading] = useState(false)

  const loadChildren = useCallback(async () => {
    if (!entry.isDirectory || children !== null) return
    setLoading(true)
    try {
      const entries = await workspace.readDir(entry.uri)
      setChildren(sortEntries(entries))
    } finally {
      setLoading(false)
    }
  }, [children, entry.isDirectory, entry.uri, workspace])

  useEffect(() => {
    if (open && entry.isDirectory) void loadChildren()
  }, [open, entry.isDirectory, loadChildren])

  const path = entry.uri.replace(/^file:\/\//, "")

  if (!entry.isDirectory) {
    if (nested) {
      return (
        <SidebarMenuSubItem>
          <SidebarMenuSubButton asChild size="sm">
            <button
              type="button"
              className="shrink-0"
              data-jet-list-item
              aria-label={entry.name}
              onClick={() => onOpenFile(entry.uri, path)}
            >
              <File />
              <span>{entry.name}</span>
            </button>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      )
    }
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          className="shrink-0"
          data-jet-list-item
          aria-label={entry.name}
          onClick={() => onOpenFile(entry.uri, path)}
        >
          <File />
          <span>{entry.name}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  }

  const folderItem = (
    <SidebarMenuItem>
      <Collapsible
        open={open}
        onOpenChange={setOpen}
        className="group/collapsible [&[data-state=open]>button>svg:first-child]:rotate-90"
      >
        <CollapsibleTrigger asChild>
          <SidebarMenuButton className="shrink-0" data-jet-list-item aria-label={entry.name}>
            <ChevronRight className="transition-transform" />
            <Folder />
            <span>{entry.name}</span>
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {loading && children === null ? (
              <SidebarMenuSkeleton showIcon />
            ) : (
              children?.map(child => (
                <ExplorerTreeNode
                  key={child.uri}
                  entry={child}
                  workspace={workspace}
                  onOpenFile={onOpenFile}
                  nested
                />
              ))
            )}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  )

  return folderItem
}

export function ExplorerTree({
  workspace,
  onOpenFile,
}: {
  workspace: WorkspaceService
  onOpenFile: (uri: string, path: string) => void
}) {
  const rootUri = workspace.root?.uri
  const [rootChildren, setRootChildren] = useState<WorkspaceEntry[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!rootUri) {
      setRootChildren([])
      return
    }
    let cancelled = false
    setLoading(true)
    void workspace.readDir(rootUri).then(entries => {
      if (cancelled) return
      setRootChildren(sortEntries(entries))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [rootUri, workspace])

  if (!rootUri) return null

  return (
    <SidebarContent
      className="min-h-0 overflow-auto"
      data-jet-list-panel="explorer"
      tabIndex={-1}
    >
      <SidebarGroup className="p-1">
        <SidebarGroupContent>
          <SidebarMenu className="gap-0" role="tree" aria-label="Explorer">
            {loading ? (
              <>
                <SidebarMenuSkeleton showIcon />
                <SidebarMenuSkeleton showIcon />
                <SidebarMenuSkeleton showIcon />
              </>
            ) : (
              rootChildren.map(entry => (
                <ExplorerTreeNode
                  key={entry.uri}
                  entry={entry}
                  workspace={workspace}
                  onOpenFile={onOpenFile}
                />
              ))
            )}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>
  )
}

/** @deprecated Use {@link ExplorerPanel} in workspace shell; kept for legacy panel-tree views. */
export function ExplorerTab({
  workspace,
  onOpenFile,
}: {
  workspace: WorkspaceService
  onOpenFile: (uri: string, path: string) => void
}) {
  if (!workspace.root) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
        <p>Open a folder to browse files</p>
        <p className="text-xs">
          Use the command palette or <strong>Open Folder</strong>.
        </p>
      </div>
    )
  }

  return <ExplorerTree workspace={workspace} onOpenFile={onOpenFile} />
}
