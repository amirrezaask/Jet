import type { PanelId } from "@gharargah/shared"
import { Trash2 } from "lucide-react"
import type { TerminalAgentShortcut } from "../tabs/TerminalExplorerTab.js"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu.js"
import { EmptySessionCard } from "./EmptySessionCard.js"
import { NewSessionMenu } from "./NewSessionMenu.js"
import { OpenInAppMenu, type OpenInAppId } from "./OpenInAppMenu.js"
import { SessionCard } from "./SessionCard.js"
import type { SessionCardModel } from "./session-card-model.js"
import type { TerminalCardStatus } from "./TerminalCard.js"

export type HomeTerminalEntry = {
  tabId: string
  panelId: PanelId
  label: string
  status: TerminalCardStatus
  exitCode?: number
  launchCommand?: string
  /** Precomputed presentation model when available. */
  session?: SessionCardModel
}

export type HomeProjectSectionProps = {
  name: string
  path: string
  rootUri: string
  terminals: HomeTerminalEntry[]
  sessions: SessionCardModel[]
  onOpenTerminal: (panelId: PanelId, tabId: string) => void
  onNewTerminal: (rootUri: string) => void
  onLaunchAgentTerminal: (rootUri: string, shortcut: TerminalAgentShortcut) => void
  onOpenInApp?: (rootUri: string, appId: OpenInAppId) => void
  onRemoveProject?: (rootUri: string) => void
  onKillTerminal?: (panelId: PanelId, tabId: string) => void
}

export function ProjectSection(props: HomeProjectSectionProps) {
  const {
    name,
    path,
    rootUri,
    terminals,
    sessions,
    onOpenTerminal,
    onNewTerminal,
    onLaunchAgentTerminal,
    onOpenInApp,
    onRemoveProject,
    onKillTerminal,
  } = props

  const titleBlock = (
    <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <h2 className="truncate text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        {name}
      </h2>
      {path ? (
        <p className="truncate font-mono text-3xs text-muted-foreground/80">{path}</p>
      ) : null}
    </div>
  )

  const actions = (
    <div className="flex shrink-0 items-center gap-0.5">
      {onOpenInApp ? (
        <OpenInAppMenu rootUri={rootUri} onOpenInApp={onOpenInApp} />
      ) : null}
      <NewSessionMenu
        rootUri={rootUri}
        onNewTerminal={onNewTerminal}
        onLaunchAgentTerminal={onLaunchAgentTerminal}
      />
    </div>
  )

  return (
    <section
      data-gharargah-project-section
      data-gharargah-project-name={name}
      className="flex flex-col gap-2 border-b border-border/40 pb-3 last:border-b-0 last:pb-0"
    >
      <div
        data-gharargah-project-row
        className="flex min-w-0 flex-1 items-center justify-between gap-2"
      >
        {onRemoveProject ? (
          <ContextMenu>
            <ContextMenuTrigger asChild>{titleBlock}</ContextMenuTrigger>
            <ContextMenuContent data-gharargah-project-menu>
              <ContextMenuItem
                variant="destructive"
                onSelect={() => onRemoveProject(rootUri)}
              >
                <Trash2 className="size-4" />
                Remove Project
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ) : (
          titleBlock
        )}
        {actions}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {sessions.length === 0 ? (
          <EmptySessionCard
            rootUri={rootUri}
            onNewTerminal={onNewTerminal}
            onLaunchAgentTerminal={onLaunchAgentTerminal}
          />
        ) : (
          sessions.map(session => {
            const term = terminals.find(t => t.tabId === session.id)
            if (!term) return null
            return (
              <SessionCard
                key={session.id}
                session={session}
                onClick={() => onOpenTerminal(term.panelId, term.tabId)}
                onKill={
                  onKillTerminal
                    ? () => onKillTerminal(term.panelId, term.tabId)
                    : undefined
                }
              />
            )
          })
        )}
      </div>
    </section>
  )
}
