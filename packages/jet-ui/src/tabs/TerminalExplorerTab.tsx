import type { PanelId } from "@jet/shared"
import { Plus, Terminal, X } from "lucide-react"
import { memo, useEffect, useMemo, useRef } from "react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../components/ui/context-menu.js"
import { SidebarProvider } from "../components/ui/sidebar.js"
import { TreeView, type TreeDataSource, type TreeNode } from "../components/TreeView.js"

export type TerminalExplorerEntry = {
  tabId: string
  panelId: PanelId
  label: string
  cwdRootUri: string
}

export type TerminalExplorerGroup = {
  id: string
  name: string
  path: string
  rootUri: string
  terminals: TerminalExplorerEntry[]
}

export const TERMINAL_EXPLORER_LIST_ID = "jet:terminal-explorer"

type TerminalNodeData =
  | { kind: "group"; group: TerminalExplorerGroup }
  | { kind: "terminal"; entry: TerminalExplorerEntry }

export const TerminalExplorerTab = memo(function TerminalExplorerTab(props: {
  groups: TerminalExplorerGroup[]
  activeTerminalTabId: string | null
  onFocusTerminal: (panelId: PanelId, tabId: string) => void
  onNewTerminal: (rootUri: string) => void
  onCloseTerminal: (panelId: PanelId, tabId: string) => void
}) {
  const { groups, activeTerminalTabId, onFocusTerminal, onNewTerminal, onCloseTerminal } = props

  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => a.name.localeCompare(b.name)),
    [groups],
  )

  const groupsRef = useRef(sortedGroups)
  groupsRef.current = sortedGroups
  const subscribersRef = useRef(new Set<() => void>())

  const source = useMemo<TreeDataSource<TerminalNodeData>>(() => {
    return {
      getRoots(): TreeNode<TerminalNodeData>[] {
        return groupsRef.current.map(group => ({
          id: group.id,
          isBranch: true,
          data: { kind: "group", group },
        }))
      },
      getChildren(id): TreeNode<TerminalNodeData>[] {
        const group = groupsRef.current.find(g => g.id === id)
        if (!group) return []
        return group.terminals.map(entry => ({
          id: entry.tabId,
          isBranch: false,
          data: { kind: "terminal", entry },
        }))
      },
      subscribe(fn: () => void): () => void {
        subscribersRef.current.add(fn)
        return () => subscribersRef.current.delete(fn)
      },
    }
  }, [])

  useEffect(() => {
    for (const fn of subscribersRef.current) fn()
  }, [sortedGroups])

  const initiallyExpanded = useMemo(() => sortedGroups.map(g => g.id), [sortedGroups])

  if (sortedGroups.length === 0) {
    return (
      <SidebarProvider className="!min-h-0 flex h-full w-full min-h-0 flex-col">
        <TreeView<TerminalNodeData>
          listId={TERMINAL_EXPLORER_LIST_ID}
          ariaLabel="Terminals"
          source={source}
          initiallyExpanded={initiallyExpanded}
          renderRow={() => null}
          emptyState={
            <p className="px-2 py-2 text-xs text-muted-foreground">
              Open a workspace to manage terminals.
            </p>
          }
        />
      </SidebarProvider>
    )
  }

  return (
    <SidebarProvider className="!min-h-0 flex h-full w-full min-h-0 flex-col">
      <TreeView<TerminalNodeData>
        listId={TERMINAL_EXPLORER_LIST_ID}
        ariaLabel="Terminals"
        source={source}
        initiallyExpanded={initiallyExpanded}
        activeId={activeTerminalTabId}
        onActivate={node => {
          if (node.data.kind === "terminal") {
            onFocusTerminal(node.data.entry.panelId, node.data.entry.tabId)
          }
        }}
        rowActions={node => {
          if (node.data.kind === "group" && node.data.group.rootUri.length > 0) {
            const rootUri = node.data.group.rootUri
            return (
              <button
                type="button"
                title="New terminal"
                aria-label="New terminal"
                className="jet-interactive-row inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                onClick={e => {
                  e.stopPropagation()
                  onNewTerminal(rootUri)
                }}
              >
                <Plus className="size-3" />
              </button>
            )
          }
          return null
        }}
        wrapRow={(node, row) => {
          if (node.data.kind !== "terminal") return row
          const entry = node.data.entry
          return (
            <ContextMenu>
              <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => onCloseTerminal(entry.panelId, entry.tabId)}>
                  <X className="size-4" />
                  Close Terminal
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )
        }}
        renderRow={node => {
          if (node.data.kind === "group") {
            const group = node.data.group
            return (
              <span
                className="truncate font-medium text-foreground"
                title={group.path || group.name}
              >
                {group.name}
              </span>
            )
          }
          const entry = node.data.entry
          return (
            <>
              <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
              <span
                className="truncate"
                title={entry.cwdRootUri ? entry.cwdRootUri.replace(/^file:\/\//, "") : entry.label}
              >
                {entry.label}
              </span>
            </>
          )
        }}
      />
    </SidebarProvider>
  )
})
