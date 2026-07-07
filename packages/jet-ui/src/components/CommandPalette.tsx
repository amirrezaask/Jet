import { useMemo } from "react"
import { Badge } from "@/components/ui/badge.js"
import { KeyBindingKbd } from "./KeyBindingKbd.js"
import { PaletteShell, type PaletteShellItem } from "./palette/PaletteShell.js"

interface CommandDescriptor {
  id: string
  title: string
  category?: string
  keybinding?: string
  aliases?: string[]
  recent?: boolean
}

export function CommandPalette({
  open,
  onOpenChange,
  commands,
  onRun,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  commands: CommandDescriptor[]
  onRun: (id: string) => void
}) {
  const items = useMemo<PaletteShellItem<CommandDescriptor>[]>(
    () =>
      commands.map(cmd => ({
        key: cmd.id,
        value: `${cmd.id} ${cmd.title} ${(cmd.aliases ?? []).join(" ")}`,
        data: cmd,
      })),
    [commands],
  )

  return (
    <PaletteShell
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Search commands…"
      placeholder="Search commands…"
      items={items}
      onSelect={cmd => onRun(cmd.id)}
      emptyLabel="No results."
      renderItem={cmd => (
        <span className="flex w-full items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate font-medium">{cmd.title}</span>
              {cmd.recent && (
                <Badge variant="secondary" className="text-xs">
                  Recent
                </Badge>
              )}
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              {cmd.category && <span>{cmd.category}</span>}
              {cmd.category && cmd.aliases?.length ? <span aria-hidden>·</span> : null}
              {cmd.aliases?.length ? <span>{cmd.aliases.join(" · ")}</span> : null}
            </span>
          </span>
          {cmd.keybinding ? (
            <KeyBindingKbd binding={cmd.keybinding} className="ml-auto shrink-0" />
          ) : null}
        </span>
      )}
    />
  )
}
