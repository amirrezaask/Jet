import { useMemo } from "react"
import { PaletteShell, type PaletteShellItem } from "./palette/PaletteShell.js"

export type OutlineEntry = {
  name: string
  line: number
  depth: number
}

export function OutlineOverlay({
  open,
  symbols,
  onOpenChange,
  onSelect,
}: {
  open: boolean
  symbols: OutlineEntry[]
  onOpenChange: (open: boolean) => void
  onSelect: (line: number) => void
}) {
  const items = useMemo<PaletteShellItem<OutlineEntry>[]>(
    () =>
      symbols.map((sym, i) => ({
        key: `${sym.line}-${sym.name}-${i}`,
        value: `${sym.name} ${sym.line}`,
        data: sym,
      })),
    [symbols],
  )

  return (
    <PaletteShell
      open={open}
      onOpenChange={onOpenChange}
      title="Document Outline"
      description="Jump to a symbol in the current file."
      placeholder="Filter symbols…"
      maxWidth="xs"
      items={items}
      onSelect={sym => onSelect(sym.line)}
      emptyLabel="No symbols found"
      itemClassName="gap-2"
      itemStyle={sym => ({ paddingLeft: 8 + sym.depth * 12 })}
      renderItem={sym => (
        <>
          <span className="min-w-0 flex-1 truncate">{sym.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{sym.line}</span>
        </>
      )}
    />
  )
}
