import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Command as CommandPrimitive } from "cmdk"

export function QuickOpenOverlay({
  open,
  onOpenChange,
  files,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  files: string[]
  onSelect: (path: string) => void
}) {
  const [query, setQuery] = useState("")

  useEffect(() => {
    if (!open) setQuery("")
  }, [open])

  if (!open || typeof document === "undefined") return null

  const q = query.toLowerCase()
  const filtered =
    q.trim() === ""
      ? files.slice(0, 50)
      : files
          .filter(f => f.toLowerCase().includes(q))
          .slice(0, 50)

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Quick open"
      onClick={() => onOpenChange(false)}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        background: "rgba(0,0,0,0.5)",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: "100%", maxWidth: "36rem" }}
      >
        <CommandPrimitive className="overflow-hidden rounded-md border border-[var(--jet-border)] bg-[var(--jet-panel-raised)] shadow-2xl">
          <CommandPrimitive.Input
            placeholder="Type a file name…"
            value={query}
            onValueChange={setQuery}
            className="w-full border-b border-[var(--jet-border)] bg-transparent px-3 py-2 text-sm outline-none"
            autoFocus
          />
          <CommandPrimitive.List className="max-h-80 overflow-auto p-1">
            <CommandPrimitive.Empty className="px-3 py-2 text-sm text-[var(--jet-text-muted)]">
              No matching files.
            </CommandPrimitive.Empty>
            {filtered.map(path => (
              <CommandPrimitive.Item
                key={path}
                value={path}
                onSelect={() => {
                  onSelect(path)
                  onOpenChange(false)
                }}
                className="cursor-pointer rounded-sm px-3 py-2 font-mono text-sm aria-selected:bg-[var(--jet-hover)]"
              >
                {path}
              </CommandPrimitive.Item>
            ))}
          </CommandPrimitive.List>
        </CommandPrimitive>
      </div>
    </div>,
    document.body,
  )
}
