import { useEffect, useMemo, useState } from "react"
import { EXPLORER_LIST_ID } from "@/explorer/focus.js"
import { Copy, Folder, Focus, Plus, Trash2 } from "lucide-react"
import type { WorkspaceEntry, WorkspaceManager } from "@jet/workspace"
import { TreeView, type TreeDataSource, type TreeNode } from "@/components/TreeView.js"
import { Button } from "@/components/ui/button.js"
import { FileIcon } from "@/lib/file-icon.js"
import { cn } from "@/lib/utils.js"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu.js"

type ExplorerData =
  | { kind: "root"; uri: string; name: string; path: string }
  | { kind: "entry"; entry: WorkspaceEntry }

function sortEntries(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return entries
    .filter(e => !e.name.startsWith("."))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

function toPath(uri: string): string {
  return uri.replace(/^file:\/\//, "")
}

function useExplorerSource(manager: WorkspaceManager): {
  source: TreeDataSource<ExplorerData>
  rootIds: string[]
  activeRootId: string | null
} {
  const [rev, setRev] = useState(0)

  useEffect(() => {
    const sub = manager.onDidChangeFolders.event(() => setRev(r => r + 1))
    const activeSub = manager.onDidChangeActiveFolder.event(() => setRev(r => r + 1))
    return () => {
      sub.dispose()
      activeSub.dispose()
    }
  }, [manager])

  const rootIds = useMemo(() => {
    void rev
    return manager.folders.map(f => f.root.uri)
  }, [rev, manager])

  const source = useMemo<TreeDataSource<ExplorerData>>(() => {
    return {
      getRoots(): TreeNode<ExplorerData>[] {
        return manager.folders.map(f => ({
          id: f.root.uri,
          isBranch: true,
          data: {
            kind: "root",
            uri: f.root.uri,
            name: f.root.name,
            path: f.root.path,
          },
        }))
      },
      async getChildren(id): Promise<TreeNode<ExplorerData>[]> {
        const entries = sortEntries(await manager.readDir(id))
        return entries.map(entry => ({
          id: entry.uri,
          isBranch: entry.isDirectory,
          data: { kind: "entry", entry },
        }))
      },
    }
    // rev in deps → new source instance when folders change → invalidates cache in TreeView
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manager, rev])

  return { source, rootIds, activeRootId: manager.activeFolder?.root.uri ?? null }
}

export function ExplorerTab({
  manager,
  onOpenFile,
  onOpenFolder,
  onActivateProject,
  onNewTerminal,
  onRemoveProject,
}: {
  manager: WorkspaceManager
  onOpenFile: (uri: string, path: string) => void
  onOpenFolder?: () => void
  onActivateProject?: (rootUri: string) => void
  onNewTerminal?: (rootUri: string) => void
  onRemoveProject?: (rootUri: string) => void
}) {
  const { source, rootIds, activeRootId } = useExplorerSource(manager)

  if (!manager.hasFolders()) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-muted-foreground">
        <p className="text-sm">Open a folder to browse files</p>
        {onOpenFolder ? (
          <Button size="sm" onClick={onOpenFolder} className="font-medium">
            Open Folder
          </Button>
        ) : (
          <p className="text-xs">Use the command palette.</p>
        )}
      </div>
    )
  }

  return (
      <TreeView<ExplorerData>
        listId={EXPLORER_LIST_ID}
        source={source}
        ariaLabel="Explorer"
        rowAriaLabel={node =>
          node.data.kind === "root" ? node.data.name : node.data.entry.name
        }
        initiallyExpanded={activeRootId ? [activeRootId] : rootIds.slice(0, 1)}
        syncExpanded
      activeId={activeRootId}
      onActivate={node => {
        if (node.data.kind === "root") {
          onActivateProject?.(node.data.uri)
        } else if (!node.data.entry.isDirectory) {
          onOpenFile(node.data.entry.uri, toPath(node.data.entry.uri))
        }
      }}
      emptyState={<div className="p-2 text-xs text-muted-foreground">Loading…</div>}
      wrapRow={(node, row) => {
        if (node.data.kind !== "root") return row
        const project = node.data
        return (
          <ContextMenu>
            <ContextMenuTrigger asChild><div>{row}</div></ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuGroup>
                <ContextMenuItem onSelect={() => onActivateProject?.(project.uri)}>
                  <Focus className="size-4" />
                  Activate Project
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => onNewTerminal?.(project.uri)}>
                  <Plus className="size-4" />
                  New Terminal
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => void navigator.clipboard.writeText(project.path)}>
                  <Copy className="size-4" />
                  Copy Project Path
                </ContextMenuItem>
              </ContextMenuGroup>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" onSelect={() => onRemoveProject?.(project.uri)}>
                <Trash2 className="size-4" />
                Remove Project
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )
      }}
      renderRow={(node, ctx) => {
        if (node.data.kind === "root") {
          return (
            <>
              <span
                aria-hidden
                data-jet-project-activity={node.data.uri === activeRootId ? "active" : "idle"}
                className={node.data.uri === activeRootId ? "h-4 w-0.5 rounded-full bg-primary" : "h-1.5 w-0.5 rounded-full bg-muted-foreground/35"}
              />
              <Folder data-jet-project-icon className="size-6! shrink-0 text-foreground/85" />
              <span
                className="truncate font-medium text-foreground"
                title={node.data.path}
              >
                {node.data.name}
              </span>
            </>
          )
        }
        const entry = node.data.entry
        return (
          <>
            <FileIcon path={entry.name} isDirectory={entry.isDirectory} />
            <span className={cn("truncate", ctx.active && "font-medium")} title={entry.name}>
              {entry.name}
            </span>
          </>
        )
      }}
    />
  )
}
