import type { PanelId } from "@gharargah/shared"
import { Check, Code2, Copy, CopyPlus, Focus, Folder, Pencil, Plus, RotateCcw, SquareTerminal, Trash2, X } from "lucide-react"
import { memo, useEffect, useMemo, useRef, useState } from "react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "../components/ui/context-menu.js"
import { Button } from "../components/ui/button.js"
import { Input } from "../components/ui/input.js"
import { Lister, type ListerDataSource, type ListerNode } from "../lister/index.js"
import { ClaudeAI, CursorIcon, GrokIcon, OpenAI, type Icon } from "../agents/composer/Icons.js"
import { PanelEmpty } from "../components/PanelEmpty.js"
import { NewSessionMenu } from "../home/NewSessionMenu.js"

export type TerminalExplorerEntry = {
  tabId: string
  panelId: PanelId
  label: string
  cwdRootUri: string
  status: "starting" | "running" | "exited" | "failed"
  exitCode?: number
}

export type TerminalExplorerGroup = {
  id: string
  name: string
  path: string
  rootUri: string
  terminals: TerminalExplorerEntry[]
}

export type TerminalAgentShortcut = {
  id: "codex" | "claude" | "opencode" | "cursor" | "cursor-acp" | "grok"
  label: string
  /** CLI binary launched in the PTY. Omit for ACP agent-chat sessions. */
  command?: string
  /** ACP transport for agent-chat sessions (e.g. cursor:acp). */
  driverId?: string
}

export const TERMINAL_EXPLORER_LIST_ID = "gharargah:terminal-explorer"

const AGENT_SHORTCUTS: Array<TerminalAgentShortcut & { Icon: Icon }> = [
  { id: "codex", label: "Codex", command: "codex", Icon: OpenAI },
  { id: "codex", label: "Codex (ACP)", driverId: "codex:acp", Icon: OpenAI },
  { id: "claude", label: "Claude", command: "claude", Icon: ClaudeAI },
  { id: "claude", label: "Claude (ACP)", driverId: "claude:acp", Icon: ClaudeAI },
  { id: "opencode", label: "OpenCode", command: "opencode", Icon: Code2 },
  { id: "opencode", label: "OpenCode (ACP)", driverId: "opencode:acp", Icon: Code2 },
  { id: "cursor", label: "Cursor Agent", command: "cursor-agent", Icon: CursorIcon },
  { id: "cursor-acp", label: "Cursor (ACP)", driverId: "cursor:acp", Icon: CursorIcon },
  { id: "grok", label: "Grok (ACP)", driverId: "grok:acp", Icon: GrokIcon },
]

type TerminalNodeData =
  | { kind: "group"; group: TerminalExplorerGroup }
  | { kind: "terminal"; entry: TerminalExplorerEntry; index: number }

export const TerminalExplorerTab = memo(function TerminalExplorerTab(props: {
  groups: TerminalExplorerGroup[]
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
  onOpenFolder?: () => void
}) {
  const {
    groups,
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
    onOpenFolder,
  } = props
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")

  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => a.name.localeCompare(b.name)),
    [groups],
  )

  const groupsRef = useRef(sortedGroups)
  groupsRef.current = sortedGroups
  const subscribersRef = useRef(new Set<() => void>())

  const source = useMemo<ListerDataSource<TerminalNodeData>>(() => {
    return {
      getRoots(): ListerNode<TerminalNodeData>[] {
        return groupsRef.current.map(group => ({
          id: group.id,
          isBranch: true,
          searchText: `${group.name} ${group.path}`,
          data: { kind: "group", group },
        }))
      },
      getChildren(id): ListerNode<TerminalNodeData>[] {
        const group = groupsRef.current.find(g => g.id === id)
        if (!group) return []
        return group.terminals.map((entry, index) => ({
          id: entry.tabId,
          isBranch: false,
          searchText: entry.label,
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

  const initiallyExpanded = useMemo(
    () => sortedGroups.filter(group => group.rootUri === activeProjectRootUri).map(group => group.id),
    [sortedGroups, activeProjectRootUri],
  )

  if (sortedGroups.length === 0) {
    return (
      <PanelEmpty
        title="Open a folder to manage terminals"
        description={onOpenFolder ? undefined : "Use the command palette to open a folder."}
        action={onOpenFolder ? <Button size="sm" onClick={onOpenFolder}>Open Folder</Button> : undefined}
      />
    )
  }

  return (
    <Lister<TerminalNodeData>
      listId={TERMINAL_EXPLORER_LIST_ID}
      mode="tree"
      filter="local"
      showInput={false}
      aria-label="Terminals"
      source={source}
      rowAriaLabel={node =>
        node.data.kind === "group" ? node.data.group.name : node.data.entry.label
      }
      initiallyExpanded={initiallyExpanded}
      syncExpanded
      activeId={activeTerminalTabId}
      onActivate={node => {
          if (node.data.kind === "group") {
            onActivateProject(node.data.group.rootUri)
          } else {
            onFocusTerminal(node.data.entry.panelId, node.data.entry.tabId)
          }
      }}
      rowActions={node => {
          if (node.data.kind === "group" && node.data.group.rootUri.length > 0) {
            const rootUri = node.data.group.rootUri
            return (
              <NewSessionMenu
                rootUri={rootUri}
                onNewTerminal={onNewTerminal}
                onLaunchAgentTerminal={onLaunchAgentTerminal}
                align="start"
                trigger={
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    data-gharargah-new-session
                    title="New session"
                    aria-label="New session"
                    className="size-6 opacity-70 group-hover/tree-row:opacity-100"
                    onClick={e => e.stopPropagation()}
                  >
                    <Plus className="size-3" />
                  </Button>
                }
              />
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
                className="size-6 opacity-0 group-hover/tree-row:opacity-100 focus-visible:opacity-100"
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
          if (node.data.kind === "group") {
            const group = node.data.group
            return (
              <ContextMenu>
                <ContextMenuTrigger asChild><div className="h-full w-full">{row}</div></ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuGroup>
                    <ContextMenuItem onSelect={() => onActivateProject(group.rootUri)}>
                      <Focus className="size-4" />
                      Activate Project
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => onNewTerminal(group.rootUri)}>
                      <Plus className="size-4" />
                      New Terminal
                    </ContextMenuItem>
                    <ContextMenuSub>
                      <ContextMenuSubTrigger>
                        <CursorIcon className="mr-2 size-4" />
                        Launch Agent
                      </ContextMenuSubTrigger>
                      <ContextMenuSubContent>
                        {AGENT_SHORTCUTS.map(shortcut => (
                          <ContextMenuItem
                            key={`${shortcut.id}:${shortcut.driverId ?? shortcut.command ?? shortcut.label}`}
                            onSelect={() => onLaunchAgentTerminal(group.rootUri, shortcut)}
                          >
                            <shortcut.Icon className="size-4" />
                            {shortcut.label}
                          </ContextMenuItem>
                        ))}
                      </ContextMenuSubContent>
                    </ContextMenuSub>
                    <ContextMenuItem onSelect={() => void navigator.clipboard.writeText(group.path)}>
                      <Copy className="size-4" />
                      Copy Project Path
                    </ContextMenuItem>
                  </ContextMenuGroup>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="destructive" onSelect={() => onRemoveProject(group.rootUri)}>
                    <Trash2 className="size-4" />
                    Remove Project
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            )
          }
          const entry = node.data.entry
          return (
            <ContextMenu>
              <ContextMenuTrigger asChild><div className="h-full w-full">{row}</div></ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuGroup>
                  <ContextMenuItem onSelect={() => onFocusTerminal(entry.panelId, entry.tabId)}>
                    <Focus className="size-4" />
                    Focus
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => {
                    setRenameValue(entry.label)
                    setRenamingTabId(entry.tabId)
                  }}>
                    <Pencil className="size-4" />
                    Rename…
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => onDuplicateTerminal(entry.tabId)}>
                    <CopyPlus className="size-4" />
                    Duplicate
                  </ContextMenuItem>
                  {entry.status === "exited" || entry.status === "failed" ? (
                    <ContextMenuItem onSelect={() => onRestartTerminal(entry.tabId)}>
                      <RotateCcw className="size-4" />
                      Restart
                    </ContextMenuItem>
                  ) : null}
                  <ContextMenuItem onSelect={() => void navigator.clipboard.writeText(entry.cwdRootUri.replace(/^file:\/\//, ""))}>
                    <Copy className="size-4" />
                    Copy Working Directory
                  </ContextMenuItem>
                </ContextMenuGroup>
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive" onSelect={() => onCloseTerminal(entry.panelId, entry.tabId)}>
                  <X className="size-4" />
                  Close Terminal
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )
      }}
      render={node => {
          if (node.data.kind === "group") {
            const group = node.data.group
            const isActive = group.rootUri === activeProjectRootUri
            return (
              <>
                <span
                  aria-hidden
                  data-gharargah-project-activity={isActive ? "active" : "idle"}
                  className={isActive ? "h-4 w-0.5 rounded-full bg-primary" : "h-1.5 w-0.5 rounded-full bg-muted-foreground/35"}
                />
                <Folder
                  aria-hidden
                  data-gharargah-project-icon
                  className="size-5! shrink-0 text-foreground/85"
                />
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
          if (renamingTabId === entry.tabId) {
            const commitRename = () => {
              const next = renameValue.trim()
              if (next) onRenameTerminal(entry.tabId, next)
              setRenamingTabId(null)
            }
            return (
              <>
                <span aria-hidden className="size-1.5 rounded-full bg-primary" />
                <Input
                  autoFocus
                  value={renameValue}
                  aria-label={`Rename ${entry.label}`}
                  className="h-6 min-w-0 flex-1 px-1.5 py-0 text-xs"
                  onClick={event => event.stopPropagation()}
                  onChange={event => setRenameValue(event.target.value)}
                  onKeyDown={event => {
                    event.stopPropagation()
                    if (event.key === "Enter") commitRename()
                    if (event.key === "Escape") setRenamingTabId(null)
                  }}
                  onBlur={commitRename}
                />
                <Check className="size-3 text-muted-foreground" />
              </>
            )
          }
          return (
            <>
              <span className="relative flex size-4 shrink-0 items-center justify-center" aria-hidden>
                <SquareTerminal className={entry.status === "exited" || entry.status === "failed" ? "size-3.5 text-destructive/80" : "size-3.5 text-muted-foreground"} />
                <span
                  data-gharargah-terminal-status={entry.status}
                  className={entry.status === "exited" || entry.status === "failed"
                    ? "absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-destructive ring-1 ring-sidebar"
                    : "absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-primary ring-1 ring-sidebar"}
                />
              </span>
              <span
                className="truncate text-sidebar-foreground"
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
