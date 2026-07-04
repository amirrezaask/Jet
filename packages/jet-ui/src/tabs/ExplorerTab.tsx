import { useEffect, type CSSProperties } from "react"
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

const EXPLORER_ROW_PX = 22

const explorerRowStyle = (level: number): CSSProperties => ({
  paddingLeft: level * 16,
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  flexShrink: 0,
  height: EXPLORER_ROW_PX,
  minHeight: EXPLORER_ROW_PX,
  position: "relative",
})

const explorerTreeStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 0,
  overflow: "auto",
}

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
      className="h-full min-h-0 p-1"
      style={explorerTreeStyle}
      aria-label="Explorer"
      data-jet-list-panel="explorer"
      tabIndex={-1}
    >
      {tree.getItems().map(item => {
        const node = item.getItemData()
        if (!node) return null
        const itemProps = item.getProps()
        return (
          <div
            key={item.getId()}
            {...itemProps}
            style={explorerRowStyle(item.getItemMeta().level)}
            className={cn(
              "cursor-pointer gap-1 rounded-sm px-1",
              "hover:bg-accent",
              item.isSelected() && "jet-list-item-selected bg-accent/50",
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
