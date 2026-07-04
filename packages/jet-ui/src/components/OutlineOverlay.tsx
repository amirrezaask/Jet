import { useEffect, useRef } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js"
import { ScrollArea } from "@/components/ui/scroll-area.js"
import { Button } from "@/components/ui/button.js"

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
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) listRef.current?.querySelector("button")?.focus()
  }, [open, symbols])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Document Outline</DialogTitle>
          <DialogDescription>Jump to a symbol in the current file.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-80">
          <div ref={listRef} className="p-1">
            {symbols.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">No symbols found</p>
            ) : (
              symbols.map((sym, i) => (
                <Button
                  key={`${sym.line}-${sym.name}-${i}`}
                  type="button"
                  variant="ghost"
                  className="flex h-auto w-full justify-start rounded-sm px-2 py-1 font-normal"
                  style={{ paddingLeft: 8 + sym.depth * 12 }}
                  onClick={() => {
                    onSelect(sym.line)
                    onOpenChange(false)
                  }}
                >
                  <span className="truncate">{sym.name}</span>
                  <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">{sym.line}</span>
                </Button>
              ))
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
