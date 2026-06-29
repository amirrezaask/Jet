import { JetFuzzyPicker } from "./JetFuzzyPicker.js"

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
                  <span className="rounded-sm border border-[var(--jet-border)] px-1 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[var(--jet-accent)]">
                    Recent
                  </span>
                )}
              </span>
              <span className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--jet-text-muted)]">
                {cmd.category && <span>{cmd.category}</span>}
                {cmd.aliases?.length ? <span>{cmd.aliases.join(" · ")}</span> : null}
              </span>
            </span>
            {cmd.keybinding && (
              <span className="jet-mono-data shrink-0 text-[var(--jet-text-muted)]">
                {cmd.keybinding}
              </span>
            )}
          </span>
        ),
        onSelect: () => onRun(cmd.id),
      }))}
    />
  )
}
