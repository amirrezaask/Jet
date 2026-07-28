import { useMemo } from "react"
import { Bot, Folder, SquareTerminal } from "lucide-react"
import { PaletteShell, type PaletteShellItem } from "../components/palette/PaletteShell.js"
import { cn } from "@/lib/utils.js"
import {
  AGENT_CLI_DRIVERS,
  type AgentCliDriver,
} from "./agent-cli-drivers.js"

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
}

export function AgentCliPickerOverlay(props: AgentCliPickerOverlayProps) {
  const {
    open,
    onOpenChange,
    onSelect,
    projects = [],
    selectedRootUri = null,
    onSelectedRootUriChange,
  } = props

  const items = useMemo<PaletteShellItem<AgentCliDriver>[]>(
    () =>
      AGENT_CLI_DRIVERS.map(driver => ({
        key: driver.id,
        value: `${driver.label} ${driver.description} ${driver.command ?? "shell"}`,
        data: driver,
      })),
    [],
  )

  const showProjectChips = projects.length > 1 && onSelectedRootUriChange != null

  const projectChips = showProjectChips ? (
    <div
      role="radiogroup"
      aria-label="Choose project"
      data-gharargah-agent-cli-project-picker=""
      className="flex min-w-0 items-center gap-1.5 overflow-x-auto border-b border-border/60 px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {projects.map(project => {
        const selected = selectedRootUri === project.rootUri
        return (
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
          ? "Pick a project, then an agent CLI for this session"
          : "Pick an agent CLI for this session"
      }
      placeholder="Filter agents…"
      size="picker"
      items={items}
      onSelect={onSelect}
      emptyLabel="No matching agents."
      statusRow={projectChips}
      renderItem={driver => (
        <>
          {driver.id === "shell" ? (
            <SquareTerminal className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <Bot className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span
              data-gharargah-agent-cli-option={driver.id}
              className="truncate text-sm font-medium text-foreground"
            >
              {driver.label}
            </span>
            <span className="truncate font-mono text-3xs text-muted-foreground">
              {driver.command ?? "login shell"}
              {" · "}
              {driver.description}
            </span>
          </span>
        </>
      )}
    />
  )
}
