import { Plus } from "lucide-react"
import type { TerminalAgentShortcut } from "../tabs/TerminalExplorerTab.js"
import { NewSessionMenu } from "./NewSessionMenu.js"

export type EmptySessionCardProps = {
  rootUri: string
  onNewTerminal: (rootUri: string) => void
  onLaunchAgentTerminal: (rootUri: string, shortcut: TerminalAgentShortcut) => void
}

export function EmptySessionCard(props: EmptySessionCardProps) {
  const { rootUri, onNewTerminal, onLaunchAgentTerminal } = props

  return (
    <NewSessionMenu
      rootUri={rootUri}
      onNewTerminal={onNewTerminal}
      onLaunchAgentTerminal={onLaunchAgentTerminal}
      align="start"
      trigger={
        <button
          type="button"
          data-gharargah-terminal-card
          data-gharargah-list-item
          data-gharargah-new-session
          data-gharargah-empty-session
          className="gharargah-home-empty-session flex w-full min-h-[5.5rem] flex-col items-start justify-center gap-1.5 rounded-xl border border-dashed px-3 py-3 text-left"
        >
          <span className="flex size-6 items-center justify-center rounded-md border border-dashed border-primary/35 text-primary/80">
            <Plus className="size-3.5" />
          </span>
          <span className="text-xs font-medium text-foreground/90">
            No sessions yet — create one
          </span>
          <span className="text-3xs text-muted-foreground">
            Start a project session with an agent, terminal, editor, and Git workspace.
          </span>
          <span className="mt-0.5 inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-3xs font-medium text-primary">
            <Plus className="size-3" />
            New session
          </span>
        </button>
      }
    />
  )
}
