import { useEffect, useMemo, useState } from "react"
import { EXPLORER_LIST_ID } from "@/explorer/focus.js"
import { File, Folder } from "lucide-react"
import type { WorkspaceEntry, WorkspaceManager } from "@jet/workspace"
import { TreeView, type TreeDataSource, type TreeNode } from "@/components/TreeView.js"
import { cn } from "@/lib/utils.js"

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
} {
  const [rev, setRev] = useState(0)

  useEffect(() => {
    const sub = manager.onDidChangeFolders.event(() => setRev(r => r + 1))
    return () => sub.dispose()
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

  return { source, rootIds }
}

export function ExplorerTab({
  manager,
  onOpenFile,
}: {
  manager: WorkspaceManager
  onOpenFile: (uri: string, path: string) => void
}) {
  const { source, rootIds } = useExplorerSource(manager)

  if (!manager.hasFolders()) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
        <p>Open a folder to browse files</p>
        <p className="text-xs">
          Use the command palette or <strong>Open Folder</strong>.
        </p>
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
        initiallyExpanded={rootIds}
      onActivate={node => {
        if (node.data.kind === "entry" && !node.data.entry.isDirectory) {
          onOpenFile(node.data.entry.uri, toPath(node.data.entry.uri))
        }
      }}
      emptyState={<div className="p-2 text-xs text-muted-foreground">Loading…</div>}
      renderRow={(node, ctx) => {
        if (node.data.kind === "root") {
          return (
            <>
              <Folder className="size-3.5 shrink-0 text-foreground" />
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
            {entry.isDirectory ? (
              <Folder className="size-3.5 shrink-0" />
            ) : (
              <File className="size-3.5 shrink-0" />
            )}
            <span className={cn("truncate", ctx.active && "font-medium")} title={entry.name}>
              {entry.name}
            </span>
          </>
        )
      }}
    />
  )
}
