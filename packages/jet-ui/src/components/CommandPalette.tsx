import { JetFuzzyPicker } from "./JetFuzzyPicker.js"
import { Badge } from "@/components/ui/badge.js"
import { CommandShortcut } from "@/components/ui/command.js"

export function CommandPalette({
  open,
  onOpenChange,
  commands,
  onRun,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  commands: {
    id: string
    title: string
    category?: string
    keybinding?: string
    aliases?: string[]
    recent?: boolean
  }[]
  onRun: (id: string) => void
}) {
  return (
    <JetFuzzyPicker
      open={open}
      onOpenChange={onOpenChange}
      ariaLabel="Command palette"
      placeholder="Search commands…"
      maxWidth="32rem"
      maxListHeight="20rem"
      items={commands.map(cmd => ({
        value: `${cmd.id} ${cmd.title} ${(cmd.aliases ?? []).join(" ")}`,
        label: (
          <span className="flex w-full items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="truncate">{cmd.title}</span>
                {cmd.recent && (
                  <Badge variant="outline" className="text-[length:var(--jet-fs-2xs)]">
                    Recent
                  </Badge>
                )}
              </span>
              <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                {cmd.category && <span>{cmd.category}</span>}
                {cmd.aliases?.length ? <span>{cmd.aliases.join(" · ")}</span> : null}
              </span>
            </span>
            {cmd.keybinding && <CommandShortcut>{cmd.keybinding}</CommandShortcut>}
          </span>
        ),
        onSelect: () => onRun(cmd.id),
      }))}
    />
  )
}
