import { useEffect, useMemo, useState } from "react"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command.js"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js"
import { COMMAND_NO_SELECTION, COMMAND_SHELL_CLASS } from "@/lib/command-shell.js"

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
  const [selectedValue, setSelectedValue] = useState(COMMAND_NO_SELECTION)

  useEffect(() => {
    if (!open) setSelectedValue(COMMAND_NO_SELECTION)
  }, [open])

  const items = useMemo(
    () =>
      symbols.map((sym, i) => ({
        key: `${sym.line}-${sym.name}-${i}`,
        value: `${sym.name} ${sym.line}`,
        sym,
      })),
    [symbols],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-hidden p-0" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>Document Outline</DialogTitle>
          <DialogDescription>Jump to a symbol in the current file.</DialogDescription>
        </DialogHeader>
        <Command
          className={COMMAND_SHELL_CLASS}
          value={selectedValue}
          onValueChange={setSelectedValue}
        >
          <CommandInput placeholder="Filter symbols…" />
          <CommandList className="max-h-80">
            <CommandEmpty>No symbols found</CommandEmpty>
            <CommandItem value={COMMAND_NO_SELECTION} className="hidden" aria-hidden />
            {items.map(({ key, value, sym }) => (
              <CommandItem
                key={key}
                value={value}
                className="gap-2"
                style={{ paddingLeft: 8 + sym.depth * 12 }}
                onSelect={() => {
                  onSelect(sym.line)
                  onOpenChange(false)
                }}
              >
                <span className="min-w-0 flex-1 truncate">{sym.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{sym.line}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
