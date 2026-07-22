import { useMemo, useState } from "react"
import { FolderPlus, Search } from "lucide-react"
import type { PanelId } from "@gharargah/shared"
import { Button } from "@/components/ui/button.js"
import { Input } from "@/components/ui/input.js"
import { Kbd } from "@/components/ui/kbd.js"
import { formatHomeDate, timeOfDayGreeting } from "./greeting.js"
import type { TerminalAgentShortcut } from "../tabs/TerminalExplorerTab.js"
import type { OpenInAppId } from "./OpenInAppMenu.js"
import { ProjectSection, type HomeTerminalEntry } from "./ProjectSection.js"
import {
  defaultSessionDescription,
  detectSessionProvider,
  mapRuntimeStatusToCardStatus,
  providerDisplayLabel,
  type SessionCardModel,
} from "./session-card-model.js"

export type HomeProjectGroup = {
  id: string
  name: string
  path: string
  rootUri: string
  terminals: HomeTerminalEntry[]
}

export type GharargahHomeProps = {
  groups: HomeProjectGroup[]
  onOpenTerminal: (panelId: PanelId, tabId: string) => void
  onNewTerminal: (rootUri: string) => void
  onLaunchAgentTerminal: (rootUri: string, shortcut: TerminalAgentShortcut) => void
  onOpenInApp?: (rootUri: string, appId: OpenInAppId) => void
  onAddProject?: () => void
  onRemoveProject?: (rootUri: string) => void
  onKillTerminal?: (panelId: PanelId, tabId: string) => void
  onOpenTodos?: (rootUri: string) => void
}

function toSessionCard(group: HomeProjectGroup, term: HomeTerminalEntry): SessionCardModel {
  if (term.session) return term.session
  const provider = detectSessionProvider(term.launchCommand)
  const kind = provider ? "agent" : "terminal"
  const status = mapRuntimeStatusToCardStatus(term.status)
  return {
    id: term.tabId,
    projectId: group.id,
    kind,
    provider: provider ?? (kind === "terminal" ? undefined : "jet"),
    providerLabel: providerDisplayLabel(kind, provider),
    title: term.label,
    description: defaultSessionDescription(kind, status),
    status,
  }
}

export function GharargahHome(props: GharargahHomeProps) {
  const {
    groups,
    onOpenTerminal,
    onNewTerminal,
    onLaunchAgentTerminal,
    onOpenInApp,
    onAddProject,
    onRemoveProject,
    onKillTerminal,
    onOpenTodos,
  } = props
  const [query, setQuery] = useState("")
  const greeting = timeOfDayGreeting()
  const dateLabel = formatHomeDate()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return groups
      .map(group => {
        const sessions = group.terminals
          .map(t => toSessionCard(group, t))
          .filter(session => {
            if (!q) return true
            const hay = [
              group.name,
              group.path,
              session.title,
              session.providerLabel,
              session.description ?? "",
              session.kind,
              session.status,
            ]
              .join(" ")
              .toLowerCase()
            return hay.includes(q)
          })
        const projectMatch =
          !q ||
          group.name.toLowerCase().includes(q) ||
          group.path.toLowerCase().includes(q)
        if (q && !projectMatch && sessions.length === 0) return null
        return { group, sessions }
      })
      .filter((row): row is { group: HomeProjectGroup; sessions: SessionCardModel[] } => row !== null)
  }, [groups, query])

  return (
    <div
      data-gharargah-home
      data-gharargah-shell="home"
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background"
    >
      <div className="flex h-full min-h-0 w-full flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
        <header
          data-gharargah-home-header
          className="flex flex-col gap-2.5"
        >
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p
                data-gharargah-home-date
                className="text-3xs font-medium tracking-[0.16em] text-muted-foreground"
              >
                {dateLabel}
              </p>
              <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-foreground">
                <span data-gharargah-home-greeting className="text-primary">
                  {greeting}
                </span>
              </h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Here&apos;s what&apos;s running today.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[14rem] flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  data-gharargah-home-search
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search projects, agents, files…"
                  className="h-8 pe-12 ps-8 text-xs"
                  aria-label="Search projects"
                />
                <Kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 border border-border/60 bg-background/40 text-4xs text-muted-foreground">
                  ⌘K
                </Kbd>
              </div>
              {onAddProject ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-gharargah-home-add-project
                  className="gap-1.5"
                  onClick={onAddProject}
                >
                  <FolderPlus className="size-3.5" />
                  Add project
                </Button>
              ) : null}
            </div>
          </div>
        </header>

        {groups.length === 0 ? (
          <div
            data-gharargah-home-empty
            className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/80 px-4 py-10 text-center"
          >
            <p className="text-sm text-muted-foreground">No projects yet. Add a folder to get started.</p>
            {onAddProject ? (
              <Button
                type="button"
                data-gharargah-home-add-project
                onClick={onAddProject}
              >
                <FolderPlus className="size-4" />
                Add project
              </Button>
            ) : null}
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No projects match “{query.trim()}”.
          </p>
        ) : (
          <div className="flex flex-col gap-3 pb-3">
            {filtered.map(({ group, sessions }) => (
              <ProjectSection
                key={group.id}
                projectId={group.path || group.id}
                name={group.name}
                path={group.path}
                rootUri={group.rootUri}
                terminals={group.terminals}
                sessions={sessions}
                onOpenTerminal={onOpenTerminal}
                onNewTerminal={onNewTerminal}
                onLaunchAgentTerminal={onLaunchAgentTerminal}
                onOpenInApp={onOpenInApp}
                onRemoveProject={onRemoveProject}
                onKillTerminal={onKillTerminal}
                onOpenTodos={onOpenTodos}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
