import { useDeferredValue, useMemo, useState } from "react"
import type { JetProject } from "@jet/workspace"
import { PaletteShell, type PaletteShellItem } from "./palette/PaletteShell.js"

function matchProject(query: string, project: JetProject): boolean {
  if (!query.trim()) return true
  const q = query.toLowerCase()
  return project.name.toLowerCase().includes(q) || project.path.toLowerCase().includes(q)
}

export function ProjectSwitcherOverlay({
  open,
  onOpenChange,
  projects,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: JetProject[]
  onSelect: (path: string) => void
}) {
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query)

  const items = useMemo<PaletteShellItem<JetProject>[]>(
    () =>
      projects
        .filter(p => matchProject(deferredQuery, p))
        .slice(0, 100)
        .map(project => ({
          key: project.path,
          value: project.path,
          data: project,
        })),
    [deferredQuery, projects],
  )

  const emptyMessage =
    projects.length === 0
      ? "No projects found — add scan roots in ~/.jet/jetrc.ts"
      : "No matching projects."

  return (
    <PaletteShell
      open={open}
      onOpenChange={onOpenChange}
      title="Switch project"
      description="Filter projects…"
      placeholder="Filter projects…"
      maxWidth="xl"
      shouldFilter={false}
      query={query}
      onQueryChange={setQuery}
      items={items}
      onSelect={project => onSelect(project.path)}
      emptyLabel={emptyMessage}
      renderItem={project => (
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 font-mono text-foreground">{project.name}</span>
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
            {project.path}
          </span>
        </span>
      )}
    />
  )
}
