import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Clock3, Folder, History, LoaderCircle, Plus, RotateCw, Trash2 } from "lucide-react"
import type {
  AgentCliHistoryResult,
  AgentCliHistorySession,
} from "@yaade/shared"
import { PaletteShell, type PaletteShellItem } from "../components/palette/PaletteShell.js"
import { Lister, type ListerNode } from "../lister/index.js"
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
const AGENT_CLI_HISTORY_ROW_HEIGHT_REM = 5

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
  loadPreviousSessions?: (
    driver: AgentCliDriver,
    rootUri: string,
    signal: AbortSignal,
  ) => Promise<AgentCliHistoryResult>
  /** Sync peek into a shared startup-warmed cache (avoids loading flash). */
  peekPreviousSessions?: (
    driver: AgentCliDriver,
    rootUri: string,
  ) => AgentCliHistoryResult | undefined
  onResumeSession?: (
    driver: AgentCliDriver,
    session: AgentCliHistorySession,
  ) => void
}

type HistoryViewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; result: AgentCliHistoryResult }
  | { status: "error"; message: string }

const historyDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

function formatHistoryDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : historyDate.format(date)
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
    loadPreviousSessions,
    peekPreviousSessions,
    onResumeSession,
  } = props

  const [highlightedDriver, setHighlightedDriver] = useState<AgentCliDriver | null>(null)
  const [historyState, setHistoryState] = useState<HistoryViewState>({ status: "idle" })
  const [retryRevision, setRetryRevision] = useState(0)
  const historyCacheRef = useRef(new Map<string, AgentCliHistoryResult>())

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

  useEffect(() => {
    if (!open || !highlightedDriver || !selectedRootUri || !loadPreviousSessions) {
      setHistoryState({ status: "idle" })
      return
    }
    const cacheKey = `${highlightedDriver.id}\u0000${selectedRootUri}`
    const cached =
      historyCacheRef.current.get(cacheKey) ??
      peekPreviousSessions?.(highlightedDriver, selectedRootUri)
    if (cached) {
      historyCacheRef.current.set(cacheKey, cached)
      setHistoryState({ status: "loaded", result: cached })
      return
    }

    const controller = new AbortController()
    setHistoryState({ status: "loading" })
    void loadPreviousSessions(highlightedDriver, selectedRootUri, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return
        historyCacheRef.current.set(cacheKey, result)
        setHistoryState({ status: "loaded", result })
      })
      .catch(error => {
        if (controller.signal.aborted) return
        setHistoryState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        })
      })
    return () => controller.abort()
  }, [
    open,
    highlightedDriver,
    selectedRootUri,
    loadPreviousSessions,
    peekPreviousSessions,
    retryRevision,
  ])

  const highlightDriver = useCallback((driver: AgentCliDriver | null) => {
    setHighlightedDriver(driver)
  }, [])

  const historyItems = useMemo<ListerNode<AgentCliHistorySession>[]>(() => {
    if (
      historyState.status !== "loaded" ||
      historyState.result.state !== "ready"
    ) {
      return []
    }
    return historyState.result.sessions.map(session => ({
      id: session.id,
      searchText: `${session.title} ${session.cwd ?? ""}`,
      data: session,
    }))
  }, [historyState])

  const resumeSession = (session: AgentCliHistorySession) => {
    if (!highlightedDriver || !onResumeSession) return
    onOpenChange(false)
    onResumeSession(highlightedDriver, session)
  }

  const historyEmptyState =
    !highlightedDriver || historyState.status === "idle" ? (
      <p className="px-2 py-6 text-center text-xs leading-5 text-muted-foreground">
        Highlight an agent to browse its CLI sessions.
      </p>
    ) : historyState.status === "loading" ? (
      <div
        role="status"
        data-yaade-agent-cli-history-loading=""
        className="flex items-center justify-center gap-2 px-2 py-6 text-xs text-muted-foreground"
      >
        <LoaderCircle className="size-3.5" aria-hidden />
        Loading CLI sessions…
      </div>
    ) : historyState.status === "error" ? (
      <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
        <p className="text-xs leading-5 text-destructive">
          {historyState.message}
        </p>
        <button
          type="button"
          onClick={() => setRetryRevision(revision => revision + 1)}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-3xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RotateCw className="size-3" aria-hidden />
          Retry
        </button>
      </div>
    ) : historyState.result.state !== "ready" ? (
      <p className="px-3 py-6 text-center text-xs leading-5 text-muted-foreground">
        {historyState.result.message}
      </p>
    ) : (
      <p className="px-3 py-6 text-center text-xs leading-5 text-muted-foreground">
        No previous sessions found for this provider.
      </p>
    )

  const historyPanel = (
    <aside
      aria-label={
        highlightedDriver
          ? `${highlightedDriver.label} previous sessions`
          : "Previous sessions"
      }
      data-yaade-agent-cli-history=""
      data-provider={highlightedDriver?.id}
      data-yaade-agent-cli-history-state={historyState.status}
      className="flex h-[min(23rem,calc(100dvh-2rem))] min-h-0 w-[20rem] min-w-0 shrink-0 flex-col overflow-hidden bg-muted/15"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/70 px-3">
        <History className="size-3.5 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-foreground">
            Previous sessions
          </p>
          <p className="truncate text-3xs text-muted-foreground">
            {highlightedDriver?.label ?? "Choose a provider"}
          </p>
        </div>
      </div>
      <Lister
        listId="agent-cli-history"
        mode="flat"
        flatVariant="palette"
        filter="none"
        items={historyItems}
        showInput={false}
        autoFocusInput={false}
        aria-label="Previous sessions"
        role="listbox"
        className="min-h-0 flex-1"
        listClassName="min-h-0 px-1.5 py-1.5"
        itemClassName="flex-col items-start gap-1 rounded-md px-2.5 py-2 text-left"
        estimateSize={() =>
          readCssLengthPx(
            "--yaade-agent-cli-history-row-height",
            AGENT_CLI_HISTORY_ROW_HEIGHT_REM,
          )
        }
        emptyState={<div aria-live="polite">{historyEmptyState}</div>}
        onActivate={node => resumeSession(node.data)}
        render={node => {
          const session = node.data
          const updatedAt = formatHistoryDate(
            session.updatedAt ?? session.createdAt,
          )
          return (
            <span
              data-yaade-agent-cli-history-session={session.id}
              className="flex w-full min-w-0 flex-col gap-1"
            >
              <span className="w-full truncate text-xs font-medium">
                {session.title}
              </span>
              {session.cwd ? (
                <span className="w-full truncate font-mono text-3xs text-muted-foreground">
                  {session.cwd}
                </span>
              ) : null}
              {updatedAt ? (
                <span className="inline-flex items-center gap-1 text-3xs text-muted-foreground">
                  <Clock3 className="size-3" aria-hidden />
                  {updatedAt}
                </span>
              ) : null}
            </span>
          )
        }}
      />
    </aside>
  )

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
      size="wide"
      fitContent={false}
      requireQueryForSelection={false}
      items={items}
      onSelect={onSelect}
      onHighlightChange={highlightDriver}
      emptyLabel="No matching agents."
      statusRow={projectChips}
      sidecar={historyPanel}
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
