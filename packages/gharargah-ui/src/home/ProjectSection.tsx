import type { PanelId } from "@gharargah/shared"
import type { TerminalAgentShortcut } from "../tabs/TerminalExplorerTab.js"
import { TerminalCard, type TerminalCardStatus } from "./TerminalCard.js"
import { NewSessionMenu } from "./NewSessionMenu.js"

export type HomeTerminalEntry = {
  tabId: string
  panelId: PanelId
  label: string
  status: TerminalCardStatus
  exitCode?: number
}

export type HomeProjectSectionProps = {
  name: string
  path: string
  rootUri: string
  terminals: HomeTerminalEntry[]
  onOpenTerminal: (panelId: PanelId, tabId: string) => void
  onNewTerminal: (rootUri: string) => void
  onLaunchAgentTerminal: (rootUri: string, shortcut: TerminalAgentShortcut) => void
}

export function ProjectSection(props: HomeProjectSectionProps) {
  const {
    name,
    path,
    rootUri,
    terminals,
    onOpenTerminal,
    onNewTerminal,
    onLaunchAgentTerminal,
  } = props
  return (
    <section
      data-gharargah-project-section
      data-gharargah-project-name={name}
      className="flex flex-col gap-3"
    >
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
            {name}
          </h2>
          {path ? (
            <p className="truncate font-mono text-3xs text-muted-foreground/80">{path}</p>
          ) : null}
        </div>
        <NewSessionMenu
          rootUri={rootUri}
          onNewTerminal={onNewTerminal}
          onLaunchAgentTerminal={onLaunchAgentTerminal}
        />
      </div>
      <div className="flex flex-wrap gap-3">
        {terminals.length === 0 ? (
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
                className="rounded-xl border border-dashed border-border/80 px-4 py-6 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
              >
                No sessions yet — create one
              </button>
            }
          />
        ) : (
          terminals.map(term => (
            <TerminalCard
              key={term.tabId}
              label={term.label}
              status={term.status}
              exitCode={term.exitCode}
              onClick={() => onOpenTerminal(term.panelId, term.tabId)}
            />
          ))
        )}
      </div>
    </section>
  )
}
