import { useEffect, useMemo, useState } from "react"
import { pathToFileUri } from "@yaade/shared"
import { cn, yaadePressClass } from "@yaade/ui"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@yaade/ui/primitives"
import { CheckIcon } from "lucide-react"
import {
  joinProjectPath,
  projectBreadcrumbs,
  type ProjectBreadcrumb,
} from "../url-workspace.js"

const MAX_SIBLINGS = 200

export type ProjectPathSwitcherProps = {
  projectPath: string
  homeDir: string
  onNavigate: (absolutePath: string) => void
}

function PathSegment({
  crumb,
  isLast,
  onNavigate,
}: {
  crumb: ProjectBreadcrumb
  isLast: boolean
  onNavigate: (absolutePath: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [siblings, setSiblings] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [highlight, setHighlight] = useState(crumb.label)
  const canSwitch = crumb.parentPath != null

  useEffect(() => {
    if (!open || !crumb.parentPath) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void window.yaade?.fs
      ?.readDir(pathToFileUri(crumb.parentPath))
      .then(entries => {
        if (cancelled) return
        const names = entries
          .filter(e => e.isDirectory)
          .map(e => e.name)
          .sort((a, b) => a.localeCompare(b))
          .slice(0, MAX_SIBLINGS)
        setSiblings(names)
        setHighlight(
          names.includes(crumb.label) ? crumb.label : (names[0] ?? ""),
        )
      })
      .catch(() => {
        if (cancelled) return
        setSiblings([])
        setError("Cannot read this directory.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, crumb.parentPath, crumb.label])

  const navigateSibling = (name: string) => {
    if (!crumb.parentPath || !name) return
    onNavigate(joinProjectPath(crumb.parentPath, name))
    setOpen(false)
  }

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setSiblings(null)
      setError(null)
      setHighlight(crumb.label)
    }
  }

  const labelClass = cn(
    yaadePressClass,
    "max-w-[12rem] truncate rounded-sm px-1 py-0.5 text-left outline-none",
    "hover:bg-accent hover:text-accent-foreground",
    "focus-visible:ring-1 focus-visible:ring-ring",
    isLast
      ? "font-semibold text-foreground"
      : "font-normal text-muted-foreground hover:text-foreground",
    open && "bg-accent text-accent-foreground",
  )

  if (!canSwitch) {
    return (
      <span
        data-yaade-path-segment={crumb.label}
        className={cn(
          "max-w-[12rem] truncate px-1 py-0.5",
          isLast
            ? "font-semibold text-foreground"
            : "text-muted-foreground",
        )}
      >
        {crumb.label}
      </span>
    )
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-yaade-path-segment={crumb.label}
          data-yaade-path-switcher={crumb.label}
          aria-label={`Switch from ${crumb.label}`}
          aria-expanded={open}
          className={labelClass}
        >
          {crumb.label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-56 p-0"
        data-yaade-path-switcher-menu={crumb.label}
        onOpenAutoFocus={e => {
          // Keep default focus on the search input (cmdk Input).
          e.preventDefault()
          const root = e.currentTarget as HTMLElement
          root.querySelector<HTMLInputElement>("[data-yaade-path-switcher-search]")?.focus()
        }}
        onCloseAutoFocus={e => e.preventDefault()}
      >
        <Command
          value={highlight}
          onValueChange={setHighlight}
          className="rounded-md"
        >
          <CommandInput
            placeholder="Filter directories…"
            aria-label="Filter directories"
            data-yaade-path-switcher-search=""
          />
          <CommandList className="max-h-64">
            {loading ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                Loading…
              </div>
            ) : error ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                {error}
              </div>
            ) : (
              <>
                <CommandEmpty className="py-3 text-xs">
                  {siblings?.length === 0 ? "No directories" : "No matches"}
                </CommandEmpty>
                <CommandGroup>
                  {(siblings ?? []).map(name => (
                    <CommandItem
                      key={name}
                      value={name}
                      data-yaade-path-sibling={name}
                      onSelect={navigateSibling}
                      className="font-mono text-xs"
                    >
                      <CheckIcon
                        className={cn(
                          "size-3.5 shrink-0",
                          name === crumb.label ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="truncate">{name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function ProjectPathSwitcher({
  projectPath,
  homeDir,
  onNavigate,
}: ProjectPathSwitcherProps) {
  const crumbs = useMemo(
    () => projectBreadcrumbs(projectPath, homeDir),
    [homeDir, projectPath],
  )

  return (
    <nav
      className="flex min-w-0 flex-1 items-center gap-0.5 text-sm"
      aria-label="Project path"
      data-yaade-project-breadcrumb=""
    >
      {crumbs.map((crumb, i) => (
        <span
          key={`${crumb.absolutePath}-${i}`}
          className="flex min-w-0 items-center gap-0.5"
        >
          {i > 0 ? (
            <span className="select-none text-muted-foreground" aria-hidden>
              /
            </span>
          ) : null}
          <PathSegment
            crumb={crumb}
            isLast={i === crumbs.length - 1}
            onNavigate={onNavigate}
          />
        </span>
      ))}
    </nav>
  )
}
