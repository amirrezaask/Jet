import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty.js"
import { KeyBindingKbd } from "@/components/KeyBindingKbd.js"
import { formatKeyBinding } from "@/lib/format-key.js"

export function PanelEmptyState() {
  return (
    <Empty className="h-full border-0 bg-background" aria-label="No file open">
      <EmptyHeader>
        <EmptyTitle>No file open</EmptyTitle>
        <EmptyDescription>Open a file or create a new buffer to get started.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <KeyBindingKbd binding={formatKeyBinding("Mod-p")} />
          <span className="text-xs text-muted-foreground">quick open</span>
          <span className="text-muted-foreground/40" aria-hidden>
            ·
          </span>
          <KeyBindingKbd binding={formatKeyBinding("Mod-n")} />
          <span className="text-xs text-muted-foreground">new file</span>
        </div>
      </EmptyContent>
    </Empty>
  )
}
