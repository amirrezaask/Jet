import { useMemo } from "react"
import type { PanelId } from "@gharargah/shared"
import { Trash2 } from "lucide-react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu.js"
import { EmptySessionCard } from "./EmptySessionCard.js"
import { NewSessionButton } from "./NewSessionButton.js"
import { OpenInAppMenu, type OpenInAppId } from "./OpenInAppMenu.js"
import { SessionCard } from "./SessionCard.js"
import type { SessionCardModel } from "./session-card-model.js"
import type { TerminalCardStatus } from "./TerminalCard.js"
import { useProjectTodosBundle } from "./todos/index.js"

function compactProjectPath(projectPath: string): string {
  const segments = projectPath.split(/[\\/]+/).filter(Boolean)
  return segments.slice(-2).join("/") || projectPath
}

export type HomeTerminalEntry = {
  tabId: string
  panelId: PanelId
  label: string
  status: TerminalCardStatus
  exitCode?: number
  launchCommand?: string
  agentId?: import("./session-card-model.js").SessionProvider
  doneAt?: string
  /** Precomputed presentation model when available. */
  session?: SessionCardModel
  /** Unread from ADE snapshot / notification center. */
  unreadCount?: number
  activityLabel?: string
  statsLine?: string
  requiresApproval?: boolean
  adeStatus?: SessionCardModel["status"]
}

export type HomeProjectSectionProps = {
  /** Stable project id — prefer absolute path (folder UUID regenerates on restore). */
  projectId: string
  name: string
  path: string
  rootUri: string
  terminals: HomeTerminalEntry[]
  sessions: SessionCardModel[]
  filtering?: boolean
  onOpenTerminal: (panelId: PanelId, tabId: string) => void
  onNewSession: (rootUri: string) => void
  onOpenInApp?: (rootUri: string, appId: OpenInAppId) => void
  onRemoveProject?: (rootUri: string) => void
  onKillTerminal?: (panelId: PanelId, tabId: string) => void
  onMarkSessionDone?: (panelId: PanelId, tabId: string) => void
  /** Open session modal on TODOs board for this project. */
  onOpenTodos?: (rootUri: string) => void
  onViewProjectNotifications?: (projectId: string) => void
  onViewSessionNotifications?: (sessionId: string) => void
}

export function ProjectSection(props: HomeProjectSectionProps) {
  const {
    projectId,
    name,
    path,
    rootUri,
    terminals,
    sessions,
    filtering = false,
    onOpenTerminal,
    onNewSession,
    onOpenInApp,
    onRemoveProject,
    onKillTerminal,
    onMarkSessionDone,
    onOpenTodos,
    onViewProjectNotifications,
    onViewSessionNotifications,
  } = props

  const todos = useProjectTodosBundle({
    projectId: projectId || path,
    projectName: name,
    onOpenTodos: onOpenTodos ? () => onOpenTodos(rootUri) : undefined,
  })
  const terminalById = useMemo(
    () => new Map(terminals.map(terminal => [terminal.tabId, terminal])),
    [terminals],
  )

  const titleBlock = (
    <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <h2 className="truncate text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        {name}
      </h2>
      {path ? (
        <p
          className="truncate font-mono text-3xs text-muted-foreground/80"
          title={path}
        >
          {compactProjectPath(path)}
        </p>
      ) : null}
    </div>
  )

  const actions = (
    <div className="flex shrink-0 items-center gap-0.5">
      {todos.summary}
      {onOpenInApp ? (
        <OpenInAppMenu rootUri={rootUri} onOpenInApp={onOpenInApp} />
      ) : null}
      <NewSessionButton rootUri={rootUri} onNewSession={onNewSession} />
    </div>
  )

  return (
    <section
      data-gharargah-project-section
      data-gharargah-project-name={name}
      data-gharargah-project-id={projectId || path}
      className="flex flex-col gap-2 border-b border-border/40 pb-3 [contain-intrinsic-size:auto_8rem] [content-visibility:auto] last:border-b-0 last:pb-0"
    >
      <div
        data-gharargah-project-row
        className="flex min-w-0 flex-1 items-center justify-between gap-2"
      >
        {onRemoveProject ? (
          <ContextMenu>
            <ContextMenuTrigger asChild>{titleBlock}</ContextMenuTrigger>
            <ContextMenuContent data-gharargah-project-menu>
              {onViewProjectNotifications ? (
                <ContextMenuItem
                  onSelect={() =>
                    onViewProjectNotifications(projectId || path)
                  }
                >
                  View project notifications
                </ContextMenuItem>
              ) : null}
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
        {sessions.length === 0 && filtering && terminals.length > 0 ? (
          <div
            className="col-span-full rounded-lg border border-dashed border-border/70 px-4 py-6 text-center text-xs text-muted-foreground"
            data-gharargah-project-no-matching-sessions=""
          >
            No matching sessions in {name}.
          </div>
        ) : sessions.length === 0 ? (
          <EmptySessionCard rootUri={rootUri} onNewSession={onNewSession} />
        ) : (
          sessions.map(session => {
            const term = terminalById.get(session.id)
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
                onMarkDone={
                  onMarkSessionDone && !term.doneAt
                    ? () => onMarkSessionDone(term.panelId, term.tabId)
                    : undefined
                }
                onViewNotifications={
                  onViewSessionNotifications
                    ? () => onViewSessionNotifications(session.id)
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
