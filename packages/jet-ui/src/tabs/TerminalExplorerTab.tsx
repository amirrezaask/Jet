import type { PanelId } from "@jet/shared"
import { ChevronRight, Plus, Terminal, X } from "lucide-react"
import { memo, useEffect, useMemo, useRef, useState } from "react"
import { ListRow } from "../components/ListRow.js"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../components/ui/context-menu.js"
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarProvider,
} from "../components/ui/sidebar.js"
import { registerListPanel } from "../lib/list-registry.js"
import { cn } from "../lib/utils.js"

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

function TerminalRow(props: {
  entry: TerminalExplorerEntry
  active: boolean
  onFocus: () => void
  onClose: () => void
}) {
  const { entry, active, onFocus, onClose } = props
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <ListRow
          data-jet-list-item
          data-tab-id={entry.tabId}
          isActive={active}
          onClick={onFocus}
        >
          <div className="flex w-full items-center gap-2 px-1 py-1.5">
            <Terminal className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <span data-slot="row-label" className="block truncate text-sm text-foreground">
                {entry.label}
              </span>
              {entry.cwdRootUri ? (
                <span data-slot="row-detail" className="block truncate text-[11px] text-muted-foreground">
                  {entry.cwdRootUri.replace(/^file:\/\//, "")}
                </span>
              ) : null}
            </div>
          </div>
        </ListRow>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onClose}>
          <X className="size-4" />
          Close Terminal
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export const TerminalExplorerTab = memo(function TerminalExplorerTab(props: {
  groups: TerminalExplorerGroup[]
  activeTerminalTabId: string | null
  onFocusTerminal: (panelId: PanelId, tabId: string) => void
  onNewTerminal: (rootUri: string) => void
  onCloseTerminal: (panelId: PanelId, tabId: string) => void
}) {
  const { groups, activeTerminalTabId, onFocusTerminal, onNewTerminal, onCloseTerminal } = props
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [expandedRoots, setExpandedRoots] = useState<ReadonlySet<string>>(
    () => new Set(groups.map(group => group.id)),
  )

  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => a.name.localeCompare(b.name)),
    [groups],
  )

  useEffect(() => registerListPanel(TERMINAL_EXPLORER_LIST_ID, contentRef.current), [])

  const toggleExpanded = (groupId: string): void => {
    setExpandedRoots(current => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  if (sortedGroups.length === 0) {
    return (
      <SidebarProvider className="!min-h-0 flex h-full w-full min-h-0 flex-col">
        <SidebarContent
          ref={contentRef}
          className="min-h-0 overflow-auto"
          data-jet-list-panel="terminal-explorer"
          tabIndex={-1}
        >
          <SidebarGroup>
            <SidebarGroupLabel>Terminals</SidebarGroupLabel>
            <SidebarGroupContent>
              <p className="px-2 text-xs text-muted-foreground">
                Open a workspace to manage terminals.
              </p>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </SidebarProvider>
    )
  }

  return (
    <SidebarProvider className="!min-h-0 flex h-full w-full min-h-0 flex-col">
      <SidebarContent
        ref={contentRef}
        className="min-h-0 overflow-auto"
        data-jet-list-panel="terminal-explorer"
        tabIndex={-1}
      >
        <SidebarGroup>
          <SidebarGroupLabel>Terminals</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {sortedGroups.map(group => {
                const expanded = expandedRoots.has(group.id)
                const canCreate = group.rootUri.length > 0
                return (
                  <SidebarMenuItem key={group.id}>
                    <SidebarMenuButton
                      className="h-auto min-h-8 py-1"
                      onClick={() => toggleExpanded(group.id)}
                      type="button"
                    >
                      <ChevronRight
                        className={cn(
                          "size-4 text-muted-foreground transition-transform",
                          expanded && "rotate-90",
                        )}
                      />
                      <div className="min-w-0 text-left">
                        <span className="block truncate font-medium">{group.name}</span>
                        {group.path ? (
                          <span className="block truncate text-xs text-muted-foreground">
                            {group.path}
                          </span>
                        ) : null}
                      </div>
                    </SidebarMenuButton>
                    {canCreate ? (
                      <SidebarMenuAction
                        title="New terminal"
                        onClick={() => onNewTerminal(group.rootUri)}
                      >
                        <Plus className="size-4" />
                      </SidebarMenuAction>
                    ) : null}
                    {expanded ? (
                      <SidebarMenuSub>
                        {group.terminals.length === 0 ? (
                          <li className="px-2 py-1.5 text-xs text-muted-foreground">
                            No terminals yet.
                          </li>
                        ) : (
                          group.terminals.map(entry => (
                            <SidebarMenuSubItem key={entry.tabId}>
                              <TerminalRow
                                entry={entry}
                                active={activeTerminalTabId === entry.tabId}
                                onFocus={() => onFocusTerminal(entry.panelId, entry.tabId)}
                                onClose={() => onCloseTerminal(entry.panelId, entry.tabId)}
                              />
                            </SidebarMenuSubItem>
                          ))
                        )}
                      </SidebarMenuSub>
                    ) : null}
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </SidebarProvider>
  )
})
