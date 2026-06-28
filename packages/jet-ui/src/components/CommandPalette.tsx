import { createPortal } from "react-dom"
import { Command as CommandPrimitive } from "cmdk"

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
  if (!open || typeof document === "undefined") return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
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
        style={{ width: "100%", maxWidth: "32rem" }}
      >
        <CommandPrimitive className="overflow-hidden rounded-md border border-[var(--jet-border)] bg-[var(--jet-panel-raised)] shadow-2xl">
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
    </div>,
    document.body,
  )
}
