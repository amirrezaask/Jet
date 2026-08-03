import { CommandPalette } from "./CommandPalette.js"

export function PaletteOverlay({
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
    <CommandPalette open={open} onOpenChange={onOpenChange} commands={commands} onRun={onRun} />
  )
}
