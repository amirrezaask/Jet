import { useMemo, useState } from "react"
import { FolderPlus, Search } from "lucide-react"
import type { PanelId } from "@gharargah/shared"
import { Button } from "@/components/ui/button.js"
import { Input } from "@/components/ui/input.js"
import { formatHomeDate, timeOfDayGreeting } from "./greeting.js"
import type { TerminalAgentShortcut } from "../tabs/TerminalExplorerTab.js"
import { ProjectSection, type HomeTerminalEntry } from "./ProjectSection.js"

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
  onAddProject?: () => void
}

export function GharargahHome(props: GharargahHomeProps) {
  const { groups, onOpenTerminal, onNewTerminal, onLaunchAgentTerminal, onAddProject } = props
  const [query, setQuery] = useState("")
  const greeting = timeOfDayGreeting()
  const dateLabel = formatHomeDate()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return groups
    return groups.filter(
      g => g.name.toLowerCase().includes(q) || g.path.toLowerCase().includes(q),
    )
  }, [groups, query])

  return (
    <div
      data-gharargah-home
      data-gharargah-shell="home"
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background"
    >
      <div className="mx-auto flex w-full max-w-6xl min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-8 py-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-3xs font-medium tracking-[0.16em] text-muted-foreground">{dateLabel}</p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
              <span className="text-primary">{greeting}</span>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">Here&apos;s what&apos;s running today.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[14rem] flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                data-gharargah-home-search
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search projects…"
                className="h-8 ps-8 text-xs"
                aria-label="Search projects"
              />
            </div>
            {onAddProject ? (
              <Button type="button" size="sm" className="gap-1.5" onClick={onAddProject}>
                <FolderPlus className="size-3.5" />
                Add project
              </Button>
            ) : null}
          </div>
        </header>

        {groups.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/80 px-6 py-16 text-center">
            <p className="text-sm text-muted-foreground">No projects yet. Add a folder to get started.</p>
            {onAddProject ? (
              <Button type="button" onClick={onAddProject}>
                <FolderPlus className="size-4" />
                Add project
              </Button>
            ) : null}
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No projects match “{query.trim()}”.</p>
        ) : (
          <div className="flex flex-col gap-10 pb-8">
            {filtered.map(group => (
              <ProjectSection
                key={group.id}
                name={group.name}
                path={group.path}
                rootUri={group.rootUri}
                terminals={group.terminals}
                onOpenTerminal={onOpenTerminal}
                onNewTerminal={onNewTerminal}
                onLaunchAgentTerminal={onLaunchAgentTerminal}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
