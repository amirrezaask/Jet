import { useDeferredValue, useEffect, useMemo, useState } from "react"
import type { JetProject } from "@jet/workspace"
import { JetFuzzyPicker } from "./JetFuzzyPicker.js"

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

  useEffect(() => {
    if (!open) setQuery("")
  }, [open])

  const filtered = useMemo(
    () => projects.filter(p => matchProject(deferredQuery, p)).slice(0, 100),
    [deferredQuery, projects],
  )

  const items = useMemo(
    () =>
      filtered.map(project => ({
        value: project.path,
        label: (
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 font-mono text-[var(--jet-text)]">{project.name}</span>
            <span className="min-w-0 truncate font-mono text-[length:var(--jet-fs-xs)] text-[var(--jet-text-muted)]">
              {project.path}
            </span>
          </span>
        ),
        onSelect: () => onSelect(project.path),
      })),
    [filtered, onSelect],
  )

  return (
    <JetFuzzyPicker
      open={open}
      onOpenChange={onOpenChange}
      ariaLabel="Switch project"
      placeholder="Filter projects…"
      emptyMessage={projects.length === 0 ? "No projects found — add scan roots in ~/.jet/jetrc.ts" : "No matching projects."}
      maxWidth="42rem"
      maxListHeight="22rem"
      shouldFilter={false}
      query={query}
      onQueryChange={setQuery}
      items={items}
    />
  )
}
