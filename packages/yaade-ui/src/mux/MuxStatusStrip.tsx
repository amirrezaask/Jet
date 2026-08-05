import {
  FolderOpen,
  Plus,
  Search,
  Settings,
  TerminalSquare,
} from "lucide-react"
import { Button } from "@/components/ui/button.js"
import { cn } from "@/lib/utils.js"

export type MuxStatusStripAction = {
  id: string
  label: string
  shortcut?: string
  onClick: () => void
  icon?: "new" | "palette" | "search" | "cd" | "settings"
}

export type MuxStatusStripProps = {
  /** Display string for the mux prefix (e.g. `Ctrl-a`). */
  prefixLabel: string
  actions: MuxStatusStripAction[]
  className?: string
}

function ActionIcon({ name }: { name: MuxStatusStripAction["icon"] }) {
  switch (name) {
    case "new":
      return <Plus className="size-3" />
    case "palette":
      return <TerminalSquare className="size-3" />
    case "search":
      return <Search className="size-3" />
    case "cd":
      return <FolderOpen className="size-3" />
    case "settings":
      return <Settings className="size-3" />
    default:
      return null
  }
}

/**
 * Persistent footer for the mux shell: prefix hint + always-visible mouse
 * affordances for actions that otherwise live only behind the prefix key.
 */
export function MuxStatusStrip(props: MuxStatusStripProps) {
  const { prefixLabel, actions, className } = props
  return (
    <footer
      data-yaade-mux-status-strip=""
      data-yaade-liquid-glass="chrome"
      className={cn(
        "flex h-6 shrink-0 items-center gap-2 border-t border-border/40 px-2 text-3xs text-muted-foreground",
        className,
      )}
    >
      <span className="flex shrink-0 items-center gap-1.5" data-yaade-mux-prefix-hint="">
        <kbd className="rounded border border-border/60 bg-muted/40 px-1 py-px font-mono text-3xs text-foreground/80">
          {prefixLabel}
        </kbd>
        <span className="hidden sm:inline">prefix</span>
      </span>
      <div className="min-w-0 flex-1" />
      <div className="flex shrink-0 items-center gap-0.5">
        {actions.map(action => (
          <Button
            key={action.id}
            type="button"
            variant="ghost"
            size="xs"
            data-yaade-mux-status-action={action.id}
            aria-label={
              action.shortcut ? `${action.label} (${action.shortcut})` : action.label
            }
            title={
              action.shortcut ? `${action.label} (${action.shortcut})` : action.label
            }
            className="h-5 gap-1 px-1.5 text-3xs text-muted-foreground hover:text-foreground"
            onClick={action.onClick}
          >
            <ActionIcon name={action.icon} />
            <span className="hidden md:inline">{action.label}</span>
          </Button>
        ))}
      </div>
    </footer>
  )
}
