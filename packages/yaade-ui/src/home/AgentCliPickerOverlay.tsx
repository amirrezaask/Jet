import { useMemo } from "react"
import { Folder, Plus, Trash2 } from "lucide-react"
import { PaletteShell, type PaletteShellItem } from "../components/palette/PaletteShell.js"
import { cn } from "@/lib/utils.js"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../components/ui/context-menu.js"
import {
  AGENT_CLI_DRIVERS,
  type AgentCliDriver,
} from "./agent-cli-drivers.js"
import { AgentProviderIcon } from "./sidebar/SessionStatusIndicator.js"
import { readCssLengthPx } from "../lister/measure.js"

const AGENT_CLI_ROW_HEIGHT_REM = 3.5

export type AgentCliPickerProject = {
  rootUri: string
  name: string
  path: string
}

export type AgentCliPickerOverlayProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (driver: AgentCliDriver) => void
  /** Workspace projects available for the new session. */
  projects?: AgentCliPickerProject[]
  /** Selected project root URI (required when creating a session). */
  selectedRootUri?: string | null
  onSelectedRootUriChange?: (rootUri: string) => void
  onRemoveProject?: (rootUri: string) => boolean | void | Promise<boolean | void>
  /** Opens the Add project folder modal (plus chip on the left). */
  onAddProject?: () => void
}

export function AgentCliPickerOverlay(props: AgentCliPickerOverlayProps) {
  const {
    open,
    onOpenChange,
    onSelect,
    projects = [],
    selectedRootUri = null,
    onSelectedRootUriChange,
    onRemoveProject,
    onAddProject,
  } = props

  const items = useMemo<PaletteShellItem<AgentCliDriver>[]>(
    () =>
      AGENT_CLI_DRIVERS.map(driver => ({
        key: driver.id,
        value: `${driver.label} ${driver.description} ${driver.command}`,
        data: driver,
      })),
    [],
  )

  const canSelectProject = onSelectedRootUriChange != null
  const showProjectChips =
    onAddProject != null || (projects.length > 1 && canSelectProject)

  const removeProject = async (
    project: AgentCliPickerProject,
    projectIndex: number,
  ) => {
    if (!onRemoveProject) return
    const removed = await onRemoveProject(project.rootUri)
    if (removed === false || selectedRootUri !== project.rootUri) return

    const remainingSelection =
      projects[projectIndex + 1] ?? projects[projectIndex - 1]
    if (remainingSelection) {
      onSelectedRootUriChange?.(remainingSelection.rootUri)
    }
  }

  const projectChips = showProjectChips ? (
    <div
      role="radiogroup"
      aria-label="Choose project"
      data-yaade-agent-cli-project-picker=""
      className="flex min-w-0 items-center gap-1.5 overflow-x-auto border-b border-border/60 px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {onAddProject ? (
        <button
          type="button"
          aria-label="Add project"
          data-yaade-agent-cli-add-project=""
          onClick={onAddProject}
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border/80",
            "text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <Plus className="size-3.5" aria-hidden />
        </button>
      ) : null}
      {projects.map((project, projectIndex) => {
        const selected = selectedRootUri === project.rootUri
        const chip = (
          <button
            key={project.rootUri}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`Project ${project.name}`}
            data-yaade-agent-cli-project-option={project.rootUri}
            data-yaade-agent-cli-project-name={project.name}
            data-state={selected ? "on" : "off"}
            onClick={() => onSelectedRootUriChange?.(project.rootUri)}
            className={cn(
              "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-3xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "border-transparent bg-muted text-foreground"
                : "border-border/80 bg-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <Folder className="size-3 shrink-0 opacity-70" aria-hidden />
            <span className="max-w-[8rem] truncate">{project.name}</span>
          </button>
        )
        if (!onRemoveProject) {
          return chip
        }
        return (
          <ContextMenu key={project.rootUri}>
            <ContextMenuTrigger asChild>{chip}</ContextMenuTrigger>
            <ContextMenuContent data-yaade-agent-cli-project-menu="">
              <ContextMenuItem
                variant="destructive"
                data-yaade-agent-cli-project-remove={project.rootUri}
                onSelect={() => void removeProject(project, projectIndex)}
              >
                <Trash2 className="size-4" aria-hidden />
                Remove {project.name}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )
      })}
    </div>
  ) : null

  return (
    <PaletteShell
      open={open}
      onOpenChange={onOpenChange}
      title="Choose agent"
      description={
        showProjectChips
          ? "Pick a project, then an agent for this session"
          : "Pick an agent for this session"
      }
      placeholder="Filter agents…"
      size="picker"
      fitContent={false}
      requireQueryForSelection={false}
      items={items}
      onSelect={onSelect}
      emptyLabel="No matching agents."
      statusRow={projectChips}
      itemClassName="justify-start py-2 text-left"
      estimateSize={() =>
        readCssLengthPx(
          "--yaade-agent-cli-row-height",
          AGENT_CLI_ROW_HEIGHT_REM,
        )
      }
      renderItem={driver => (
        <span className="flex w-full min-w-0 items-center justify-start gap-3 text-left">
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/50"
            aria-hidden
          >
            <AgentProviderIcon agent={driver.id} className="size-3.5" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left">
            <span
              data-yaade-agent-cli-option={driver.id}
              className="w-full truncate text-left text-sm font-medium text-foreground"
            >
              {driver.label}
            </span>
            <span className="w-full truncate text-left font-mono text-3xs text-muted-foreground">
              {`${driver.command} · ${driver.description}`}
            </span>
          </span>
        </span>
      )}
    />
  )
}
