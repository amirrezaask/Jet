import { useEffect, useRef } from "react"
import { JetOverlay } from "./JetOverlay.js"

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
    <JetOverlay open={open} onOpenChange={onOpenChange} ariaLabel="Document outline" maxWidth="28rem">
      <div className="overflow-hidden rounded-md border border-[var(--jet-border)] bg-[var(--jet-panel-raised)] shadow-2xl">
        <div className="border-b border-[var(--jet-border)] px-3 py-2 text-sm font-medium">
          Document Outline
        </div>
        <div ref={listRef} className="max-h-80 overflow-auto p-1">
          {symbols.length === 0 ? (
            <p className="px-2 py-3 text-sm text-[var(--jet-text-muted)]">No symbols found</p>
          ) : (
            symbols.map((sym, i) => (
              <button
                key={`${sym.line}-${sym.name}-${i}`}
                type="button"
                className="flex w-full rounded-sm px-2 py-1 text-left text-sm hover:bg-[var(--jet-hover)]"
                style={{ paddingLeft: 8 + sym.depth * 12 }}
                onClick={() => {
                  onSelect(sym.line)
                  onOpenChange(false)
                }}
              >
                <span className="truncate">{sym.name}</span>
                <span className="ml-auto shrink-0 pl-2 text-xs text-[var(--jet-text-muted)]">
                  {sym.line}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </JetOverlay>
  )
}
