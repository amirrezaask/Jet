import { useMemo } from "react"
import { Folder, Trash2 } from "lucide-react"
import {
  agentDriverIdForMode,
  type AgentDriverMode,
} from "@gharargah/agents"
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
  driverModes?: Record<string, AgentDriverMode>
  onDriverModeChange?: (agentId: string, mode: AgentDriverMode) => void
}

function stopRowActivation(event: {
  stopPropagation: () => void
  preventDefault: () => void
}) {
  event.stopPropagation()
  event.preventDefault()
}

function AgentDriverModeToggle(props: {
  driver: AgentCliDriver
  mode: AgentDriverMode
  onDriverModeChange: (agentId: string, mode: AgentDriverMode) => void
}) {
  const { driver, mode, onDriverModeChange } = props
  const options: AgentDriverMode[] = ["cli", "native"]

  return (
    <div
      role="radiogroup"
      aria-label={`${driver.label} driver mode`}
      data-gharargah-agent-driver-mode-group={driver.id}
      className="ml-auto flex shrink-0 items-center gap-0.5 rounded-full border border-border/80 p-0.5"
      onClick={stopRowActivation}
      onMouseDown={stopRowActivation}
      onPointerDown={stopRowActivation}
    >
      {options.map(option => {
        const selected = mode === option
        const label = option === "cli" ? "CLI" : "Native"
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            data-gharargah-agent-driver-mode-option={`${driver.id}:${option}`}
            data-state={selected ? "on" : "off"}
            onClick={event => {
              stopRowActivation(event)
              if (!selected) onDriverModeChange(driver.id, option)
            }}
            onMouseDown={stopRowActivation}
            onPointerDown={stopRowActivation}
            className={cn(
              "inline-flex h-6 min-w-[2.75rem] items-center justify-center rounded-full px-2 text-3xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
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
    driverModes = {},
    onDriverModeChange,
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

  const showProjectChips = projects.length > 1 && onSelectedRootUriChange != null
  const showDriverModeToggle = onDriverModeChange != null

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
      data-gharargah-agent-cli-project-picker=""
      className="flex min-w-0 items-center gap-1.5 overflow-x-auto border-b border-border/60 px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {projects.map((project, projectIndex) => {
        const selected = selectedRootUri === project.rootUri
        const chip = (
          <button
            key={project.rootUri}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`Project ${project.name}`}
            data-gharargah-agent-cli-project-option={project.rootUri}
            data-gharargah-agent-cli-project-name={project.name}
            data-state={selected ? "on" : "off"}
            onClick={() => onSelectedRootUriChange(project.rootUri)}
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
            <ContextMenuContent data-gharargah-agent-cli-project-menu="">
              <ContextMenuItem
                variant="destructive"
                data-gharargah-agent-cli-project-remove={project.rootUri}
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
      requireQueryForSelection={false}
      items={items}
      onSelect={onSelect}
      emptyLabel="No matching agents."
      statusRow={projectChips}
      itemClassName="justify-start py-2 text-left"
      estimateSize={() =>
        readCssLengthPx(
          "--gharargah-agent-cli-row-height",
          AGENT_CLI_ROW_HEIGHT_REM,
        )
      }
      renderItem={driver => {
        const mode = driverModes[driver.id] ?? "cli"
        const secondary =
          mode === "native"
            ? `${agentDriverIdForMode(driver.id, "native")} · ${driver.description}`
            : `${driver.command} · ${driver.description}`

        return (
          <span className="flex w-full min-w-0 items-center justify-start gap-3 text-left">
            <span
              className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/50"
              aria-hidden
            >
              <AgentProviderIcon agent={driver.id} className="size-3.5" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left">
              <span
                data-gharargah-agent-cli-option={driver.id}
                className="w-full truncate text-left text-sm font-medium text-foreground"
              >
                {driver.label}
              </span>
              <span className="w-full truncate text-left font-mono text-3xs text-muted-foreground">
                {secondary}
              </span>
            </span>
            {showDriverModeToggle ? (
              <AgentDriverModeToggle
                driver={driver}
                mode={mode}
                onDriverModeChange={onDriverModeChange}
              />
            ) : null}
          </span>
        )
      }}
    />
  )
}
