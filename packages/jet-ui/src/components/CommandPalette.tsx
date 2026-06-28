import { JetFuzzyPicker } from "./JetFuzzyPicker.js"

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
  return (
    <JetFuzzyPicker
      open={open}
      onOpenChange={onOpenChange}
      ariaLabel="Command palette"
      placeholder="Type a command..."
      maxWidth="32rem"
      maxListHeight="18rem"
      items={commands.map(cmd => ({
        value: `${cmd.title} ${cmd.id}`,
        label: (
          <>
            <span>{cmd.title}</span>
            {cmd.category && (
              <span className="ml-2 text-[var(--jet-text-muted)]">{cmd.category}</span>
            )}
          </>
        ),
        onSelect: () => onRun(cmd.id),
      }))}
    />
  )
}
