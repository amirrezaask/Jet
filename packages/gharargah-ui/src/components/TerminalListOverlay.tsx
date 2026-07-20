import { useMemo } from "react"
import type { PanelId } from "@gharargah/shared"
import { SquareTerminal } from "lucide-react"
import type { TerminalExplorerGroup } from "@/tabs/TerminalExplorerTab.js"
import { PaletteShell, type PaletteShellItem } from "./palette/PaletteShell.js"

export type TerminalListEntry = {
  panelId: PanelId
  tabId: string
  workspaceName: string
  title: string
}

export function TerminalListOverlay({
  open,
  onOpenChange,
  groups,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  groups: TerminalExplorerGroup[]
  onSelect: (entry: TerminalListEntry) => void
}) {
  const items = useMemo<PaletteShellItem<TerminalListEntry>[]>(
    () => groups.flatMap(group => group.terminals.map(terminal => {
      const entry = {
        panelId: terminal.panelId,
        tabId: terminal.tabId,
        workspaceName: group.name,
        title: terminal.label,
      }
      return {
        key: terminal.tabId,
        value: `${group.name} ${terminal.label}`,
        data: entry,
      }
    })),
    [groups],
  )

  return (
    <PaletteShell
      open={open}
      onOpenChange={onOpenChange}
      title="Terminal list"
      description="Switch terminal…"
      placeholder="Switch terminal…"
      items={items}
      onSelect={onSelect}
      emptyLabel="No open terminals"
      renderItem={entry => (
        <>
          <SquareTerminal className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate">
            <span className="text-muted-foreground">{entry.workspaceName}:</span>{" "}
            <span data-slot="row-label">{entry.title}</span>
          </span>
        </>
      )}
    />
  )
}
