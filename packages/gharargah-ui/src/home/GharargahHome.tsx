import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { FolderPlus, Search, SearchX } from "lucide-react"
import type { PanelId } from "@gharargah/shared"
import { Button } from "@/components/ui/button.js"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty.js"
import { Input } from "@/components/ui/input.js"
import { Kbd } from "@/components/ui/kbd.js"
import { KeyBindingKbd } from "@/components/KeyBindingKbd.js"
import { formatKeyBinding } from "@/lib/format-key.js"
import { formatHomeDate, timeOfDayGreeting } from "./greeting.js"
import type { OpenInAppId } from "./OpenInAppMenu.js"
import { ProjectSection, type HomeTerminalEntry } from "./ProjectSection.js"
import {
  defaultSessionDescription,
  detectSessionProvider,
  mapRuntimeStatusToCardStatus,
  sessionAgentLabel,
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
  onNewSession: (rootUri: string) => void
  onOpenInApp?: (rootUri: string, appId: OpenInAppId) => void
  onRemoveProject?: (rootUri: string) => void
  onKillTerminal?: (panelId: PanelId, tabId: string) => void
  onArchiveSession?: (panelId: PanelId, tabId: string) => void
  onOpenTodos?: (rootUri: string) => void
  notificationBell?: ReactNode
  onViewProjectNotifications?: (projectId: string) => void
  onViewSessionNotifications?: (sessionId: string) => void
}

function toSessionCard(group: HomeProjectGroup, term: HomeTerminalEntry): SessionCardModel {
  if (term.session) return term.session
  const agentId = term.agentId ?? detectSessionProvider(term.launchCommand)
  const status =
    term.adeStatus ??
    mapRuntimeStatusToCardStatus(term.status, Boolean(term.archivedAt))
  return {
    id: term.tabId,
    projectId: group.id,
    kind: "session",
    agentId,
    agentLabel: sessionAgentLabel(agentId),
    title: term.label,
    description:
      term.activityLabel ??
      defaultSessionDescription(agentId ? "agent" : "terminal", status),
    status,
    requiresApproval: term.requiresApproval,
    unreadCount: term.unreadCount,
    statsLine: term.statsLine,
  }
}

export function GharargahHome(props: GharargahHomeProps) {
  const {
    groups,
    onOpenTerminal,
    onNewSession,
    onOpenInApp,
    onRemoveProject,
    onKillTerminal,
    onArchiveSession,
    onOpenTodos,
    notificationBell,
    onViewProjectNotifications,
    onViewSessionNotifications,
  } = props
  const [query, setQuery] = useState("")
  const searchRef = useRef<HTMLInputElement>(null)
  const deferredQuery = useDeferredValue(query)
  const greeting = timeOfDayGreeting()
  const dateLabel = formatHomeDate()

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
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
              session.agentLabel,
              session.description ?? "",
              session.agentId ?? session.kind,
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
  }, [groups, deferredQuery])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return
      const target = event.target
      const editing =
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable='true']") !=
          null

      if (
        event.key === "/" &&
        !editing &&
        document.querySelector(
          "[data-gharargah-terminal-modal], [role='dialog'][data-state='open']",
        ) == null &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }

      if (
        event.key !== "Escape" ||
        document.activeElement !== searchRef.current
      ) {
        return
      }
      event.preventDefault()
      if (searchRef.current?.value) {
        setQuery("")
      } else {
        searchRef.current?.blur()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const resultCount = filtered.reduce(
    (count, row) => count + row.sessions.length,
    0,
  )

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
              {notificationBell}
              <div className="relative min-w-[14rem] flex-1">
                <Search
                  className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  ref={searchRef}
                  data-gharargah-home-search
                  data-gharargah-liquid-glass="chrome"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search projects or sessions…"
                  className="h-8 rounded-full border-transparent bg-transparent pe-8 ps-8 text-xs shadow-none"
                  aria-label="Search projects and sessions"
                  aria-keyshortcuts="/"
                />
                <Kbd
                  aria-hidden
                  className="absolute top-1/2 right-2 h-4 min-w-4 -translate-y-1/2 bg-transparent px-0 text-3xs"
                >
                  /
                </Kbd>
              </div>
            </div>
          </div>
        </header>

        {groups.length === 0 ? (
          <Empty
            data-gharargah-home-empty
            data-gharargah-liquid-glass="panel"
            className="border-transparent bg-transparent"
          >
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderPlus aria-hidden />
              </EmptyMedia>
              <EmptyTitle>No projects yet</EmptyTitle>
              <EmptyDescription>
                Add a folder from the command palette to start a CLI session in
                its project context.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : filtered.length === 0 ? (
          <Empty
            data-gharargah-home-empty="search"
            className="border border-dashed border-border/70"
          >
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchX aria-hidden />
              </EmptyMedia>
              <EmptyTitle>No matching projects or sessions</EmptyTitle>
              <EmptyDescription>
                Nothing matches “{deferredQuery.trim()}”. Try another project,
                session, or agent name.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setQuery("")
                  searchRef.current?.focus()
                }}
              >
                Clear search
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div
            className="flex flex-col gap-3 pb-3"
            aria-busy={query !== deferredQuery}
          >
            {filtered.map(({ group, sessions }) => (
              <ProjectSection
                key={group.id}
                projectId={group.path || group.id}
                name={group.name}
                path={group.path}
                rootUri={group.rootUri}
                terminals={group.terminals}
                sessions={sessions}
                filtering={query.trim().length > 0}
                onOpenTerminal={onOpenTerminal}
                onNewSession={onNewSession}
                onOpenInApp={onOpenInApp}
                onRemoveProject={onRemoveProject}
                onKillTerminal={onKillTerminal}
                onArchiveSession={onArchiveSession}
                onOpenTodos={onOpenTodos}
                onViewProjectNotifications={onViewProjectNotifications}
                onViewSessionNotifications={onViewSessionNotifications}
              />
            ))}
          </div>
        )}
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {query.trim()
            ? `${filtered.length} projects and ${resultCount} sessions shown.`
            : ""}
        </p>

        <footer
          data-gharargah-home-shortcuts=""
          className="mt-auto flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-border/40 pt-3 pb-1 text-3xs text-muted-foreground"
        >
          <span className="inline-flex items-center gap-1">
            <KeyBindingKbd binding={formatKeyBinding("Mod-n")} />
            New
          </span>
          <span className="inline-flex items-center gap-1">
            <KeyBindingKbd binding={formatKeyBinding("Mod-k")} />
            Switch
          </span>
          <span className="inline-flex items-center gap-1">
            <KeyBindingKbd binding={formatKeyBinding("Mod-p")} />
            Open
          </span>
          <span className="inline-flex items-center gap-1">
            <KeyBindingKbd binding={formatKeyBinding("Mod-Shift-g")} />
            Git
          </span>
          <span className="inline-flex items-center gap-1">
            <KeyBindingKbd binding={formatKeyBinding("Mod-Shift-p")} />
            Palette
          </span>
        </footer>
      </div>
    </div>
  )
}
