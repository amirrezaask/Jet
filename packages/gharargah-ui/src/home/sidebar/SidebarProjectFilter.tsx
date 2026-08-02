import { forwardRef, type ReactNode, type ButtonHTMLAttributes } from "react"
import { Folder } from "lucide-react"
import { cn } from "@/lib/utils.js"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu.js"
import type { ProjectSidebarActions } from "./ProjectSidebarItem.js"
import type { SidebarProject } from "./types.js"
import { sameProjectPath } from "./project-path.js"

/** `null` = All projects. Value is absolute project path. */
export type SidebarProjectFilterId = string | null

export type SidebarProjectFilterProps = {
  projects: SidebarProject[]
  value: SidebarProjectFilterId
  onChange: (value: SidebarProjectFilterId) => void
  projectActions?: ProjectSidebarActions
  className?: string
}

const FilterChip = forwardRef<
  HTMLButtonElement,
  {
    selected: boolean
    children: ReactNode
    "aria-label": string
    "data-option": string
  } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "type">
>(function FilterChip(
  {
    selected,
    children,
    "aria-label": ariaLabel,
    "data-option": dataOption,
    className,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={ariaLabel}
      data-gharargah-sidebar-project-filter-option={dataOption}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-3xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-sidebar-border bg-sidebar-accent text-sidebar-accent-foreground"
          : "border-sidebar-border/80 bg-sidebar/40 text-sidebar-foreground/80 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
        className,
      )}
      {...props}
      data-state={selected ? "on" : "off"}
    >
      {children}
    </button>
  )
})


export function SidebarProjectFilter({
  projects,
  value,
  onChange,
  projectActions,
  className,
}: SidebarProjectFilterProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Filter by project"
      data-gharargah-sidebar-project-filter=""
      className={cn(
        "flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      <FilterChip
        selected={value == null}
        onClick={() => onChange(null)}
        aria-label="All projects"
        data-option="all"
      >
        All
      </FilterChip>
      {projects.map(project => {
        const selected =
          value != null && sameProjectPath(value, project.path)
        const chip = (
          <FilterChip
            selected={selected}
            onClick={() => onChange(project.path)}
            aria-label={`Filter ${project.name}`}
            data-option={project.path}
          >
            <Folder className="size-3 shrink-0 opacity-70" aria-hidden />
            <span className="max-w-[7rem] truncate">{project.name}</span>
            {project.unreadCount > 0 ? (
              <span
                className="rounded-full bg-primary/20 px-1 text-4xs tabular-nums text-primary"
                data-gharargah-sidebar-project-filter-unread=""
              >
                {project.unreadCount > 99 ? "99+" : project.unreadCount}
              </span>
            ) : null}
          </FilterChip>
        )

        if (!projectActions) {
          return <span key={project.id}>{chip}</span>
        }

        return (
          <ContextMenu key={project.id}>
            <ContextMenuTrigger asChild>{chip}</ContextMenuTrigger>
            <ContextMenuContent data-gharargah-sidebar-project-filter-menu="">
              <ContextMenuItem onSelect={() => projectActions.onNewSession(project)}>
                New session
              </ContextMenuItem>
              {projectActions.onOpenProject ? (
                <ContextMenuItem
                  onSelect={() => projectActions.onOpenProject?.(project)}
                >
                  Open project
                </ContextMenuItem>
              ) : null}
              {projectActions.onRevealFolder ? (
                <ContextMenuItem
                  onSelect={() => projectActions.onRevealFolder?.(project)}
                >
                  Reveal in Finder
                </ContextMenuItem>
              ) : null}
              {projectActions.onRemoveProject ? (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    variant="destructive"
                    onSelect={() => projectActions.onRemoveProject?.(project)}
                  >
                    Remove project
                  </ContextMenuItem>
                </>
              ) : null}
            </ContextMenuContent>
          </ContextMenu>
        )
      })}
    </div>
  )
}
