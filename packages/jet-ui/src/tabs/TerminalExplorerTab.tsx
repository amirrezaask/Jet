import type { PanelId } from "@jet/shared"
import { ChevronRight, Plus, Terminal, X } from "lucide-react"
import { memo, useEffect, useMemo, useRef, useState } from "react"
import { ListRow } from "../components/ListRow.js"
import { Button } from "../components/ui/button.js"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../components/ui/context-menu.js"
import { SidebarContent } from "../components/ui/sidebar.js"
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
          className={cn(active && "bg-sidebar-accent")}
          onClick={onFocus}
        >
          <div className="flex w-full items-center gap-2 px-3 py-2">
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

  return (
    <SidebarContent
      ref={contentRef}
      className="min-h-0 overflow-auto p-2"
      data-jet-list-panel="terminal-explorer"
      tabIndex={-1}
    >
      <div className="mb-2 px-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        Terminals
      </div>
      <div className="space-y-2">
        {sortedGroups.length === 0 ? (
          <div className="rounded-lg px-3 py-2 text-xs text-muted-foreground">
            Open a workspace to manage terminals.
          </div>
        ) : (
          sortedGroups.map(group => {
            const expanded = expandedRoots.has(group.id)
            const canCreate = group.rootUri.length > 0
            return (
              <div key={group.id} className="rounded-xl border border-border/60 bg-card/30">
                <div className="flex items-center gap-1 px-2 py-2">
                  <button
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() =>
                      setExpandedRoots(current => {
                        const next = new Set(current)
                        if (next.has(group.id)) next.delete(group.id)
                        else next.add(group.id)
                        return next
                      })
                    }
                    type="button"
                  >
                    <ChevronRight
                      className={cn(
                        "size-4 text-muted-foreground transition-transform",
                        expanded && "rotate-90",
                      )}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{group.name}</div>
                      {group.path ? (
                        <div className="truncate text-xs text-muted-foreground">{group.path}</div>
                      ) : null}
                    </div>
                  </button>
                  {canCreate ? (
                    <Button
                      size="icon-sm"
                      title="New terminal"
                      variant="ghost"
                      onClick={() => onNewTerminal(group.rootUri)}
                    >
                      <Plus className="size-4" />
                    </Button>
                  ) : null}
                </div>
                {expanded ? (
                  <div className="space-y-1 px-2 pb-2">
                    {group.terminals.length === 0 ? (
                      <div className="rounded-lg px-3 py-2 text-xs text-muted-foreground">
                        No terminals yet.
                      </div>
                    ) : (
                      group.terminals.map(entry => (
                        <TerminalRow
                          key={entry.tabId}
                          entry={entry}
                          active={activeTerminalTabId === entry.tabId}
                          onFocus={() => onFocusTerminal(entry.panelId, entry.tabId)}
                          onClose={() => onCloseTerminal(entry.panelId, entry.tabId)}
                        />
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </SidebarContent>
  )
})
