import { useDeferredValue, useEffect, useMemo, useState } from "react"
import type { JetProject } from "@jet/workspace"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command.js"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js"
import { COMMAND_NO_SELECTION, COMMAND_SHELL_CLASS } from "@/lib/command-shell.js"

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
  const [selectedValue, setSelectedValue] = useState(COMMAND_NO_SELECTION)
  const deferredQuery = useDeferredValue(query)

  useEffect(() => {
    if (!open) {
      setQuery("")
      setSelectedValue(COMMAND_NO_SELECTION)
    }
  }, [open])

  const filtered = useMemo(
    () => projects.filter(p => matchProject(deferredQuery, p)).slice(0, 100),
    [deferredQuery, projects],
  )

  useEffect(() => {
    if (query.trim() === "") {
      setSelectedValue(COMMAND_NO_SELECTION)
      return
    }
    if (filtered.length > 0 && !filtered.some(p => p.path === selectedValue)) {
      setSelectedValue(filtered[0]!.path)
    }
  }, [filtered, query, selectedValue])

  const emptyMessage =
    projects.length === 0
      ? "No projects found — add scan roots in ~/.jet/jetrc.ts"
      : "No matching projects."

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>Switch project</DialogTitle>
        <DialogDescription>Filter projects…</DialogDescription>
      </DialogHeader>
      <DialogContent className="max-w-[42rem] overflow-hidden p-0" showCloseButton={false}>
        <Command
          className={COMMAND_SHELL_CLASS}
          shouldFilter={false}
          value={selectedValue}
          onValueChange={value => {
            if (query.trim() === "") {
              setSelectedValue(COMMAND_NO_SELECTION)
              return
            }
            setSelectedValue(value)
          }}
        >
          <CommandInput placeholder="Filter projects…" value={query} onValueChange={setQuery} />
          <CommandList className="max-h-[22rem]">
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandItem value={COMMAND_NO_SELECTION} className="hidden" aria-hidden />
            {filtered.map(project => (
              <CommandItem
                key={project.path}
                value={project.path}
                onSelect={() => {
                  onSelect(project.path)
                  onOpenChange(false)
                }}
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="shrink-0 font-mono text-foreground">{project.name}</span>
                  <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                    {project.path}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
