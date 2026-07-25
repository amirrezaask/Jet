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
          className="gharargah-home-empty-session flex w-full min-h-16 flex-col items-start justify-center gap-0.5 rounded-xl border border-dashed px-3 py-2.5 text-left"
        >
          <span className="flex items-center gap-2">
            <span className="flex size-5 items-center justify-center rounded-md border border-dashed border-primary/35 text-primary/80">
              <Plus className="size-3" />
            </span>
            <span className="text-xs font-medium text-foreground/90">New session</span>
          </span>
          <span className="pl-7 text-3xs text-muted-foreground">Terminal or CLI</span>
        </button>
      }
    />
  )
}
