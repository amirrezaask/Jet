import { JetFuzzyPicker } from "./JetFuzzyPicker.js"

export function CommandPalette({
  open,
  onOpenChange,
  commands,
  onRun,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  commands: { id: string; title: string; category?: string; keybinding?: string }[]
  onRun: (id: string) => void
}) {
  return (
    <JetFuzzyPicker
      open={open}
      onOpenChange={onOpenChange}
      ariaLabel="Command palette"
      placeholder="Search commands…"
      maxWidth="32rem"
      maxListHeight="18rem"
      items={commands.map(cmd => ({
        value: `${cmd.title} ${cmd.category ?? ""}`,
        label: (
          <span className="flex w-full items-center justify-between gap-3">
            <span className="min-w-0 truncate">
              <span>{cmd.title}</span>
              {cmd.category && (
                <span className="ml-2 text-[var(--jet-text-muted)]">{cmd.category}</span>
              )}
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
