import type { PanelId } from "@jet/shared"
import { ChevronDown, Plus, X } from "lucide-react"
import { memo, useEffect, useMemo, useRef } from "react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../components/ui/context-menu.js"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.js"
import { Button } from "../components/ui/button.js"
import { TreeView, type TreeDataSource, type TreeNode } from "../components/TreeView.js"
import { ClaudeAI, CursorIcon, OpenAI, type Icon } from "../agents/composer/Icons.js"

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

export type TerminalAgentShortcut = {
  id: "codex" | "claude" | "cursor"
  label: string
  command: string
}

export const TERMINAL_EXPLORER_LIST_ID = "jet:terminal-explorer"

const AGENT_SHORTCUTS: Array<TerminalAgentShortcut & { Icon: Icon }> = [
  { id: "codex", label: "Codex", command: "codex", Icon: OpenAI },
  { id: "claude", label: "Claude", command: "claude", Icon: ClaudeAI },
  { id: "cursor", label: "Cursor Agent", command: "cursor-agent", Icon: CursorIcon },
]

type TerminalNodeData =
  | { kind: "group"; group: TerminalExplorerGroup }
  | { kind: "terminal"; entry: TerminalExplorerEntry; index: number }

export const TerminalExplorerTab = memo(function TerminalExplorerTab(props: {
  groups: TerminalExplorerGroup[]
  activeTerminalTabId: string | null
  onFocusTerminal: (panelId: PanelId, tabId: string) => void
  onNewTerminal: (rootUri: string) => void
  onLaunchAgentTerminal: (rootUri: string, shortcut: TerminalAgentShortcut) => void
  onCloseTerminal: (panelId: PanelId, tabId: string) => void
  onOpenFolder?: () => void
}) {
  const {
    groups,
    activeTerminalTabId,
    onFocusTerminal,
    onNewTerminal,
    onLaunchAgentTerminal,
    onCloseTerminal,
    onOpenFolder,
  } = props

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
        return group.terminals.map((entry, index) => ({
          id: entry.tabId,
          isBranch: false,
          data: { kind: "terminal", entry, index },
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
      <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-muted-foreground">
        <p className="text-sm">Open a folder to manage terminals</p>
        {onOpenFolder ? (
          <Button size="sm" onClick={onOpenFolder} className="font-medium">
            Open Folder
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <TreeView<TerminalNodeData>
      listId={TERMINAL_EXPLORER_LIST_ID}
      ariaLabel="Terminals"
      source={source}
      rowAriaLabel={node =>
        node.data.kind === "group" ? node.data.group.name : node.data.entry.label
      }
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
              <span className="flex items-center gap-0.5">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  title="New terminal"
                  aria-label="New terminal"
                  className="size-5 opacity-70 group-hover/tree-row:opacity-100"
                  onClick={e => {
                    e.stopPropagation()
                    onNewTerminal(rootUri)
                  }}
                >
                  <Plus className="size-3" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      title="Launch agent"
                      aria-label="Launch agent"
                      className="size-5 opacity-70 group-hover/tree-row:opacity-100"
                      onClick={e => e.stopPropagation()}
                    >
                      <ChevronDown className="size-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" side="right">
                  {AGENT_SHORTCUTS.map(shortcut => (
                    <DropdownMenuItem
                      key={shortcut.id}
                      onSelect={() => onLaunchAgentTerminal(rootUri, shortcut)}
                    >
                      <shortcut.Icon className="size-4" />
                      {shortcut.label}
                    </DropdownMenuItem>
                  ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </span>
            )
          }
          if (node.data.kind === "terminal") {
            const entry = node.data.entry
            return (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                title="Close terminal"
                aria-label="Close terminal"
                className="size-5 opacity-0 group-hover/tree-row:opacity-100"
                onClick={e => {
                  e.stopPropagation()
                  onCloseTerminal(entry.panelId, entry.tabId)
                }}
              >
                <X className="size-3" />
              </Button>
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
            const letter = (group.name.trim()[0] ?? "?").toUpperCase()
            return (
              <>
                <span
                  aria-hidden
                  className="flex size-5 shrink-0 items-center justify-center rounded-md bg-primary/15 text-[10px] font-semibold text-primary"
                >
                  {letter}
                </span>
                <span
                  className="truncate font-medium text-foreground"
                  title={group.path || group.name}
                >
                  {group.name}
                </span>
              </>
            )
          }
          const entry = node.data.entry
          const num = node.data.index + 1
          return (
            <>
              <span
                aria-hidden
                className="flex size-5 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[10px] font-semibold tabular-nums text-primary"
              >
                {num}
              </span>
              <span
                className="truncate text-muted-foreground"
                title={entry.cwdRootUri ? entry.cwdRootUri.replace(/^file:\/\//, "") : entry.label}
              >
                {entry.label}
              </span>
            </>
          )
        }}
      />
  )
})
