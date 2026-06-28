import * as React from "react"
import { Command as CommandPrimitive } from "cmdk"
import { cn } from "../lib/utils.js"

export function CommandPalette({
  open,
  onOpenChange,
  commands,
  onRun,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  commands: { id: string; title: string; category?: string }[]
  onRun: (id: string) => void
}) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[15vh]"
      onClick={() => onOpenChange(false)}
    >
      <CommandPrimitive
        className="w-full max-w-lg overflow-hidden rounded-md border border-[var(--jet-border)] bg-[var(--jet-panel-raised)] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <CommandPrimitive.Input
          placeholder="Type a command..."
          className="w-full border-b border-[var(--jet-border)] bg-transparent px-3 py-2 text-sm outline-none"
          autoFocus
        />
        <CommandPrimitive.List className="max-h-72 overflow-auto p-1">
          <CommandPrimitive.Empty className="px-3 py-2 text-sm text-[var(--jet-text-muted)]">
            No results.
          </CommandPrimitive.Empty>
          {commands.map(cmd => (
            <CommandPrimitive.Item
              key={cmd.id}
              value={`${cmd.title} ${cmd.id}`}
              onSelect={() => {
                onRun(cmd.id)
                onOpenChange(false)
              }}
              className="cursor-pointer rounded-sm px-3 py-2 text-sm aria-selected:bg-[var(--jet-hover)]"
            >
              <span>{cmd.title}</span>
              {cmd.category && (
                <span className="ml-2 text-[var(--jet-text-muted)]">{cmd.category}</span>
              )}
            </CommandPrimitive.Item>
          ))}
        </CommandPrimitive.List>
      </CommandPrimitive>
    </div>
  )
}
