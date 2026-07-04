import { useEffect } from "react"
import {
  asyncDataLoaderFeature,
  hotkeysCoreFeature,
  selectionFeature,
} from "@headless-tree/core"
import { useTree } from "@headless-tree/react"
import { Folder, File, ChevronRight, ChevronDown } from "lucide-react"
import type { WorkspaceService } from "@jet/workspace"
import { cn } from "../lib/utils.js"

type TreeNode = { uri: string; name: string; isDirectory: boolean }

const nodeCache = new Map<string, TreeNode>()

export function ExplorerTab({
  workspace,
  onOpenFile,
}: {
  workspace: WorkspaceService
  onOpenFile: (uri: string, path: string) => void
}) {
  const rootUri = workspace.root?.uri

  useEffect(() => {
    nodeCache.clear()
    if (workspace.root) {
      nodeCache.set(workspace.root.uri, {
        uri: workspace.root.uri,
        name: workspace.root.name,
        isDirectory: true,
      })
    }
  }, [workspace.root])

  const tree = useTree<TreeNode>({
    rootItemId: rootUri ?? "empty",
    initialState: rootUri ? { expandedItems: [rootUri] } : undefined,
    getItemName: item => item.getItemData()?.name ?? "?",
    isItemFolder: item => item.getItemData()?.isDirectory ?? false,
    dataLoader: {
      getItem: async itemId => {
        const cached = nodeCache.get(itemId)
        if (cached) return cached
        if (workspace.root && itemId === workspace.root.uri) {
          const node = {
            uri: workspace.root.uri,
            name: workspace.root.name,
            isDirectory: true,
          }
          nodeCache.set(itemId, node)
          return node
        }
        try {
          const stat = await window.jet?.fs.stat(itemId)
          const name = itemId.split("/").pop() ?? itemId
          const node = {
            uri: itemId,
            name,
            isDirectory: stat?.isDirectory ?? false,
          }
          nodeCache.set(itemId, node)
          return node
        } catch {
          return { uri: itemId, name: itemId, isDirectory: false }
        }
      },
      getChildren: async itemId => {
        if (!workspace.root) return []
        const entries = await workspace.readDir(itemId)
        for (const e of entries) {
          nodeCache.set(e.uri, {
            uri: e.uri,
            name: e.name,
            isDirectory: e.isDirectory,
          })
        }
        return entries
          .filter(e => !e.name.startsWith("."))
          .sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
            return a.name.localeCompare(b.name)
          })
          .map(e => e.uri)
      },
    },
    features: [asyncDataLoaderFeature, hotkeysCoreFeature, selectionFeature],
    indent: 16,
    onPrimaryAction: item => {
      const node = item.getItemData()
      if (!node || node.isDirectory) return
      onOpenFile(node.uri, node.uri.replace(/^file:\/\//, ""))
    },
  })

  useEffect(() => {
    if (!rootUri) return
    void tree.getItemInstance(rootUri).expand()
  }, [rootUri, tree])

  if (!rootUri) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
        <p>Open a folder to browse files</p>
        <p className="text-xs">Use the command palette or <strong>Open Folder</strong>.</p>
      </div>
    )
  }

  return (
    <div
      {...tree.getContainerProps()}
      className="h-full overflow-auto p-1"
      aria-label="Explorer"
      data-jet-list-panel="explorer"
      tabIndex={-1}
    >
      {tree.getItems().map(item => {
        const node = item.getItemData()
        if (!node) return null
        return (
          <div
            key={item.getId()}
            {...item.getProps()}
            style={{ paddingLeft: item.getItemMeta().level * 16 }}
            className={cn(
              "flex h-[var(--jet-row-height)] cursor-pointer items-center gap-1 rounded-sm px-1",
              "hover:bg-accent",
              item.isSelected() && "bg-accent/50",
            )}
            data-jet-list-item
          >
            {item.isFolder() ? (
              item.isExpanded() ? (
                <ChevronDown className="size-3 shrink-0" />
              ) : (
                <ChevronRight className="size-3 shrink-0" />
              )
            ) : (
              <span className="size-3 shrink-0" />
            )}
            {node.isDirectory ? (
              <Folder className="size-3.5 shrink-0 text-foreground" />
            ) : (
              <File className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{node.name}</span>
          </div>
        )
      })}
    </div>
  )
}
