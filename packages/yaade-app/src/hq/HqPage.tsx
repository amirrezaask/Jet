import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"
import type { HqAgentSummary, HqProjectSummary } from "@yaade/rpc"
import { pathToFileUri } from "@yaade/shared"
import type { AgentCliDriver } from "@yaade/ui/agent-picker"
import { bundledThemeList } from "@yaade/ui/appearance"
import { NotificationBell } from "@yaade/ui/notifications"
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@yaade/ui/primitives"
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CircleDot,
  FolderKanban,
  FolderOpen,
  RefreshCw,
  Search,
  Settings,
  Trash2,
} from "lucide-react"
import { useAppearanceSettings } from "../hooks/useAppearanceSettings.js"
import { useHqOverview } from "../hooks/useHqOverview.js"
import { useSystemSignals } from "../system-signals/SystemSignalsProvider.js"
import { filterHqAgents, type HqAgentFilter } from "./hq-model.js"

const HqAgentDialog = lazy(() => import("./HqAgentDialog.js"))
const AgentCliPickerOverlay = lazy(() =>
  import("@yaade/ui/agent-picker").then(module => ({
    default: module.AgentCliPickerOverlay,
  })),
)
const SettingsOverlay = lazy(() =>
  import("@yaade/ui/settings").then(module => ({
    default: module.SettingsOverlay,
  })),
)

export type KnownProject = {
  id: string
  name: string
  rootPath: string
}

export type HqPageProps = {
  homeDir: string
  machineHostname: string
  onOpenProject: (project: Pick<HqProjectSummary, "id" | "rootPath">) => void
  onOpenWorkspace: (agent: HqAgentSummary) => void
  onOpenRegisteredProject: (project: KnownProject) => void
  onLaunchAgent: (
    project: Pick<HqProjectSummary, "id" | "rootPath">,
    driverId: AgentCliDriver["id"],
  ) => void
  onCountsChange?: (counts: {
    projects: number
    agents: number
    attention: number
    unread: number
  }) => void
}

type BadgeVariant = "default" | "secondary" | "destructive" | "outline"

function relativeTime(value: string | null): string {
  if (!value) return "No activity"
  const delta = Math.max(0, Date.now() - new Date(value).getTime())
  const minutes = Math.floor(delta / 60_000)
  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function formatRuntime(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return "<1m"
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function statusLabel(agent: HqAgentSummary): string {
  if (agent.telemetry === "pending") return "Connecting"
  return agent.status.replaceAll("_", " ")
}

function statusVariant(agent: HqAgentSummary): BadgeVariant {
  if (agent.attention) return "destructive"
  if (agent.status === "working" || agent.status === "running_tool") {
    return "default"
  }
  if (agent.telemetry === "pending") return "outline"
  return "secondary"
}

function resolveProjectInput(input: string, homeDir: string): string {
  const trimmed = input.trim()
  if (trimmed === "~") return homeDir
  if (trimmed.startsWith("~/")) {
    return `${homeDir.replace(/\/+$/, "")}/${trimmed.slice(2)}`
  }
  return trimmed
}

export function HqPage({
  homeDir,
  machineHostname,
  onOpenProject,
  onOpenWorkspace,
  onOpenRegisteredProject,
  onLaunchAgent,
  onCountsChange,
}: HqPageProps) {
  const overview = useHqOverview()
  const notifications = useSystemSignals()
  const {
    appearanceSettings,
    setAppearanceSettings,
    activeTheme,
    resetAppearanceSettings,
  } = useAppearanceSettings()
  const [query, setQuery] = useState("")
  const [projectId, setProjectId] = useState("")
  const [filter, setFilter] = useState<HqAgentFilter>("all")
  const [selectedAgent, setSelectedAgent] = useState<HqAgentSummary | null>(null)
  const [selectedLaunchRootUri, setSelectedLaunchRootUri] = useState<string | null>(null)
  const [openProjectOpen, setOpenProjectOpen] = useState(false)
  const [projectInput, setProjectInput] = useState("")
  const [projectError, setProjectError] = useState<string | null>(null)
  const [projectSubmitting, setProjectSubmitting] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const snapshot = overview.snapshot

  useEffect(() => {
    document.title = "HQ · YAADE"
  }, [])

  useEffect(() => {
    const openSettings = () => setSettingsOpen(true)
    window.addEventListener("yaade:open-settings", openSettings)
    return () => window.removeEventListener("yaade:open-settings", openSettings)
  }, [])

  useEffect(() => {
    const openAgent = (event: Event) => {
      const sessionId = (event as CustomEvent<{ sessionId?: string }>).detail
        ?.sessionId
      if (!sessionId) return
      const agent = snapshot?.agents.find(item => item.sessionId === sessionId)
      if (agent) setSelectedAgent(agent)
    }
    window.addEventListener("yaade:open-agent", openAgent)
    return () => window.removeEventListener("yaade:open-agent", openAgent)
  }, [snapshot])

  const agents = useMemo(
    () =>
      filterHqAgents(snapshot?.agents ?? [], {
        query,
        projectId,
        filter,
      }),
    [filter, projectId, query, snapshot?.agents],
  )
  const attentionCount =
    snapshot?.agents.filter(agent => agent.attention).length ?? 0
  const workingCount =
    snapshot?.agents.filter(
      agent => agent.status === "working" || agent.status === "running_tool",
    ).length ?? 0
  const availableProjectCount =
    snapshot?.projects.filter(project => project.availability === "available")
      .length ?? 0
  const launchProjects = useMemo(
    () =>
      (snapshot?.projects ?? [])
        .filter(project => project.availability === "available")
        .map(project => ({
          rootUri: pathToFileUri(project.rootPath),
          name: project.name,
          path: project.rootPath,
        })),
    [snapshot?.projects],
  )

  useEffect(() => {
    onCountsChange?.({
      projects: snapshot?.projects.length ?? 0,
      agents: snapshot?.agents.length ?? 0,
      attention: Math.max(attentionCount, notifications.counts.actionRequired),
      unread: notifications.counts.totalUnread,
    })
  }, [
    attentionCount,
    notifications.counts.actionRequired,
    notifications.counts.totalUnread,
    onCountsChange,
    snapshot?.agents.length,
    snapshot?.projects.length,
  ])

  const submitProject = useCallback(async () => {
    const rootPath = resolveProjectInput(projectInput, homeDir)
    if (!rootPath.startsWith("/")) {
      setProjectError("Enter an absolute path or a path beginning with ~/.")
      return
    }
    setProjectSubmitting(true)
    setProjectError(null)
    try {
      const response = await fetch("/api/v1/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ rootPath }),
      })
      const body = (await response.json()) as KnownProject & {
        error?: { message?: string }
      }
      if (!response.ok) {
        throw new Error(body.error?.message ?? "Could not open this project")
      }
      setOpenProjectOpen(false)
      setProjectInput("")
      onOpenRegisteredProject(body)
    } catch (cause) {
      setProjectError(
        cause instanceof Error ? cause.message : "Could not open project",
      )
    } finally {
      setProjectSubmitting(false)
    }
  }, [homeDir, onOpenRegisteredProject, projectInput])

  const forgetProject = async (project: HqProjectSummary) => {
    await fetch(`/api/v1/projects/${encodeURIComponent(project.id)}`, {
      method: "DELETE",
    })
    await overview.refresh()
  }

  if (overview.loading && !snapshot) {
    return <HqSkeleton />
  }

  return (
    <TooltipProvider>
      <div
        className="flex h-full min-h-0 flex-col bg-background text-foreground"
        data-yaade-shell="hq"
      >
        <header
          className="flex h-11 shrink-0 items-center gap-2 overflow-x-auto border-b border-border px-3 sm:px-4"
          data-yaade-app-header=""
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/12 text-primary">
              <Bot aria-hidden />
            </span>
            <div className="flex min-w-0 items-baseline gap-1.5 text-sm">
              <span className="font-semibold">YAADE</span>
              <span className="text-xs text-muted-foreground">HQ</span>
            </div>
            <Badge
              variant={overview.error ? "destructive" : "outline"}
              className="hidden h-6 max-w-64 gap-1 px-1.5 text-xs sm:inline-flex"
            >
              <CircleDot aria-hidden />
              <span className="truncate font-mono">
                {snapshot?.machineHostname ?? machineHostname}
              </span>
            </Badge>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setOpenProjectOpen(true)}
            >
              <FolderOpen data-icon="inline-start" />
              <span className="hidden sm:inline">Open Project</span>
            </Button>
            <NotificationBell
              counts={notifications.counts}
              onClick={() => notifications.setOpen(true)}
              className="size-6"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Refresh HQ"
                  disabled={overview.refreshing}
                  onClick={() => void overview.refresh()}
                >
                  {overview.refreshing ? <Spinner /> : <RefreshCw />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh system snapshot</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Settings"
                  onPointerEnter={() => void import("@yaade/ui/settings")}
                  onFocus={() => void import("@yaade/ui/settings")}
                  onClick={() => setSettingsOpen(true)}
                >
                  <Settings />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Settings</TooltipContent>
            </Tooltip>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-4 px-3 py-4 sm:px-5 lg:px-6">
            {overview.error ? (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                  <span>
                    Live reconciliation failed. Showing the latest available
                    system snapshot.
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void overview.refresh()}
                  >
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}

            <section
              aria-label="System overview"
              className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
              data-yaade-hq-summary=""
            >
              <SummaryCard
                title="Needs attention"
                value={Math.max(
                  attentionCount,
                  notifications.counts.actionRequired,
                )}
                description="Waiting, permission, or failed"
                icon={AlertTriangle}
              />
              <SummaryCard
                title="Live agents"
                value={snapshot?.agents.length ?? 0}
                description={`${workingCount} actively working`}
                icon={Bot}
              />
              <SummaryCard
                title="Known projects"
                value={snapshot?.projects.length ?? 0}
                description={`${availableProjectCount} available`}
                icon={FolderKanban}
              />
              <SummaryCard
                title="Unread"
                value={notifications.counts.totalUnread}
                description={`${notifications.counts.errors} errors`}
                icon={Activity}
              />
            </section>

            <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.65fr)_minmax(20rem,0.65fr)] xl:items-start">
              <section
                className="min-w-0 p-3 sm:p-4"
                aria-labelledby="hq-live-agents-heading"
                data-yaade-hq-column="agents"
                data-yaade-island=""
              >
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h2 id="hq-live-agents-heading" className="text-base font-semibold">
                      Live agents
                    </h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Running agent workloads on this machine.
                    </p>
                  </div>
                  <div>
                    <Badge variant="secondary">
                      {agents.length} of {snapshot?.agents.length ?? 0}
                    </Badge>
                  </div>
                </div>
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex flex-1 flex-col gap-3 sm:flex-row">
                      <div className="relative min-w-0 flex-1">
                        <Search
                          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                          aria-hidden
                        />
                        <Input
                          value={query}
                          onChange={event => setQuery(event.target.value)}
                          placeholder="Search agents, projects, or activity"
                          aria-label="Search live agents"
                          className="pl-9"
                        />
                      </div>
                      <Select
                        value={projectId || "__all__"}
                        onValueChange={value =>
                          setProjectId(value === "__all__" ? "" : value)
                        }
                      >
                        <SelectTrigger
                          className="w-full sm:w-52"
                          aria-label="Filter agents by project"
                        >
                          <SelectValue placeholder="All projects" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="__all__">All projects</SelectItem>
                            {snapshot?.projects.map(project => (
                              <SelectItem key={project.id} value={project.id}>
                                {project.name}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>
                    <Tabs
                      value={filter}
                      onValueChange={value => setFilter(value as HqAgentFilter)}
                    >
                      <TabsList aria-label="Filter agents by status">
                        <TabsTrigger value="all">All</TabsTrigger>
                        <TabsTrigger value="attention">Attention</TabsTrigger>
                        <TabsTrigger value="working">Working</TabsTrigger>
                        <TabsTrigger value="idle">Idle</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>

                  <AgentTable
                    agents={agents}
                    totalAgents={snapshot?.agents.length ?? 0}
                    onOpen={setSelectedAgent}
                    onOpenProject={agent =>
                      onOpenProject({
                        id: agent.projectId,
                        rootPath: agent.projectPath,
                      })
                    }
                  />
                </div>
              </section>

              <ProjectShortcuts
                projects={snapshot?.projects ?? []}
                onOpen={onOpenProject}
                onLaunch={project =>
                  setSelectedLaunchRootUri(pathToFileUri(project.rootPath))
                }
                onForget={project => void forgetProject(project)}
              />
            </div>
          </div>
        </main>

        <Dialog open={openProjectOpen} onOpenChange={setOpenProjectOpen}>
          <DialogContent size="prompt">
            <DialogHeader>
              <DialogTitle>Open a project</DialogTitle>
              <DialogDescription>
                Enter an absolute path or a path relative to your home directory.
              </DialogDescription>
            </DialogHeader>
            <form
              onSubmit={event => {
                event.preventDefault()
                void submitProject()
              }}
            >
              <FieldGroup>
                <Field data-invalid={projectError ? true : undefined}>
                  <FieldLabel htmlFor="hq-project-path">Project path</FieldLabel>
                  <Input
                    id="hq-project-path"
                    autoFocus
                    value={projectInput}
                    onChange={event => setProjectInput(event.target.value)}
                    placeholder="~/dev/project"
                    aria-invalid={projectError ? true : undefined}
                    className="font-mono"
                  />
                  <FieldDescription>
                    Paths outside your home directory use a stable project URL.
                  </FieldDescription>
                  {projectError ? <FieldError>{projectError}</FieldError> : null}
                </Field>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setOpenProjectOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={!projectInput.trim() || projectSubmitting}
                  >
                    {projectSubmitting ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <FolderOpen data-icon="inline-start" />
                    )}
                    Open Project
                  </Button>
                </DialogFooter>
              </FieldGroup>
            </form>
          </DialogContent>
        </Dialog>

        {selectedAgent ? (
          <Suspense fallback={null}>
            <HqAgentDialog
              agent={selectedAgent}
              open
              onOpenChange={open => {
                if (!open) setSelectedAgent(null)
              }}
              theme={activeTheme}
              onOpenProject={agent =>
                onOpenProject({
                  id: agent.projectId,
                  rootPath: agent.projectPath,
                })
              }
              onOpenWorkspace={onOpenWorkspace}
            />
          </Suspense>
        ) : null}

        {selectedLaunchRootUri ? (
          <Suspense fallback={null}>
            <AgentCliPickerOverlay
              open
              onOpenChange={open => {
                if (!open) setSelectedLaunchRootUri(null)
              }}
              projects={launchProjects}
              selectedRootUri={selectedLaunchRootUri}
              onSelectedRootUriChange={setSelectedLaunchRootUri}
              onSelect={driver => {
                const project = snapshot?.projects.find(
                  candidate =>
                    candidate.availability === "available" &&
                    pathToFileUri(candidate.rootPath) === selectedLaunchRootUri,
                )
                if (!project) return
                setSelectedLaunchRootUri(null)
                onLaunchAgent(project, driver.id)
              }}
            />
          </Suspense>
        ) : null}

        {settingsOpen ? (
          <Suspense fallback={null}>
            <SettingsOverlay
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
              settings={appearanceSettings}
              onSettingsChange={setAppearanceSettings}
              themes={bundledThemeList}
              onReset={resetAppearanceSettings}
            />
          </Suspense>
        ) : null}
      </div>
    </TooltipProvider>
  )
}

function SummaryCard({
  title,
  value,
  description,
  icon: Icon,
}: {
  title: string
  value: number
  description: string
  icon: typeof Activity
}) {
  return (
    <Card className="gap-2 border-border bg-card py-3">
      <CardHeader className="gap-1 px-3">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <span className="flex size-7 items-center justify-center rounded-md bg-secondary text-muted-foreground">
            <Icon className="size-3.5" aria-hidden />
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className="px-3">
        <p className="text-xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  )
}

function AgentTable({
  agents,
  totalAgents,
  onOpen,
  onOpenProject,
}: {
  agents: readonly HqAgentSummary[]
  totalAgents: number
  onOpen: (agent: HqAgentSummary) => void
  onOpenProject: (agent: HqAgentSummary) => void
}) {
  if (agents.length === 0) {
    return (
      <div data-yaade-list-panel="hq-agents">
        <Empty className="min-h-64 border-0 bg-secondary/50">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Bot />
            </EmptyMedia>
            <EmptyTitle>No live agents</EmptyTitle>
            <EmptyDescription>
              {totalAgents > 0
                ? "No live agents match the current filters."
                : "Launch an agent from a project workspace and it will appear here."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <div
      className="overflow-hidden rounded-md border border-border bg-secondary/20"
      data-yaade-list-panel="hq-agents"
    >
      <Table aria-label="Live agents">
        <TableHeader>
          <TableRow>
            <TableHead>Agent</TableHead>
            <TableHead>Project</TableHead>
            <TableHead className="hidden lg:table-cell">Activity</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden md:table-cell">Runtime</TableHead>
            <TableHead className="text-right">Unread</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.map(agent => (
            <TableRow
              key={`${agent.sessionId}:${agent.ptyId}`}
              data-yaade-list-item
              data-yaade-hq-agent={agent.sessionId}
              className="shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              tabIndex={0}
              onClick={() => onOpen(agent)}
              onKeyDown={event => {
                if (event.key !== "Enter" && event.key !== " ") return
                event.preventDefault()
                onOpen(agent)
              }}
            >
              <TableCell>
                <div className="min-w-44">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="max-w-full justify-start"
                    onClick={event => {
                      event.stopPropagation()
                      onOpen(agent)
                    }}
                  >
                    <Bot data-icon="inline-start" />
                    <span className="truncate">{agent.title}</span>
                  </Button>
                  <div className="flex max-w-64 items-center gap-2 px-2">
                    <Badge variant="outline">{agent.provider}</Badge>
                    <span className="truncate text-xs text-muted-foreground">
                      {agent.projectSessionTitle}
                    </span>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <Button
                  size="sm"
                  variant="link"
                  onClick={event => {
                    event.stopPropagation()
                    onOpenProject(agent)
                  }}
                >
                  <span className="max-w-40 truncate">{agent.projectName}</span>
                </Button>
              </TableCell>
              <TableCell className="hidden max-w-80 lg:table-cell">
                <p className="truncate">{agent.activity}</p>
                {agent.currentTool ? (
                  <p className="truncate text-xs text-muted-foreground">
                    {agent.currentTool.name}
                  </p>
                ) : null}
              </TableCell>
              <TableCell>
                <Badge variant={statusVariant(agent)} className="capitalize">
                  {statusLabel(agent)}
                </Badge>
              </TableCell>
              <TableCell className="hidden font-mono md:table-cell">
                {formatRuntime(agent.runtimeMs)}
              </TableCell>
              <TableCell className="text-right">
                {agent.unreadCount > 0 ? (
                  <Badge>{agent.unreadCount}</Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function ProjectShortcuts({
  projects,
  onOpen,
  onLaunch,
  onForget,
}: {
  projects: readonly HqProjectSummary[]
  onOpen: (project: Pick<HqProjectSummary, "id" | "rootPath">) => void
  onLaunch: (project: HqProjectSummary) => void
  onForget: (project: HqProjectSummary) => void
}) {
  return (
    <section
      className="min-w-0 p-3 sm:p-4"
      aria-labelledby="hq-projects-heading"
      data-yaade-hq-column="projects"
      data-yaade-island=""
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 id="hq-projects-heading" className="text-base font-semibold">
            Projects
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Open a workspace or launch an agent.
          </p>
        </div>
        <div>
          <Badge variant="secondary">{projects.length}</Badge>
        </div>
      </div>
      {projects.length === 0 ? (
        <div data-yaade-list-panel="hq-projects">
          <Empty className="min-h-56 border-0 bg-secondary/50">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderKanban />
              </EmptyMedia>
              <EmptyTitle>No known projects</EmptyTitle>
              <EmptyDescription>
                Open a project to add it to this host.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      ) : (
        <ItemGroup
          className="gap-0.5"
          data-yaade-list-panel="hq-projects"
        >
          {projects.map(project => (
            <Item
              key={project.id}
              size="sm"
              className="min-w-0 flex-nowrap hover:bg-accent"
              data-yaade-list-item
              data-yaade-hq-project={project.id}
            >
              <FolderKanban className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <ItemContent>
                <ItemTitle className="flex items-center gap-2">
                  <span className="truncate">{project.name}</span>
                  {project.availability !== "available" ? (
                    <Badge variant="destructive" className="shrink-0 capitalize">
                      {project.availability}
                    </Badge>
                  ) : null}
                </ItemTitle>
                <ItemDescription className="truncate font-mono text-xs">
                  {project.rootPath}
                </ItemDescription>
                <ItemDescription className="flex flex-wrap items-center gap-x-2 text-xs">
                  <span>{project.sessionCount} sessions</span>
                  <span>{project.liveAgentCount} live</span>
                  <span>{relativeTime(project.lastActivityAt)}</span>
                </ItemDescription>
                {project.attentionCount > 0 || project.unreadCount > 0 ? (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {project.attentionCount > 0 ? (
                      <Badge variant="destructive">
                        {project.attentionCount} attention
                      </Badge>
                    ) : null}
                    {project.unreadCount > 0 ? (
                      <Badge>{project.unreadCount} unread</Badge>
                    ) : null}
                  </div>
                ) : null}
              </ItemContent>
              {project.availability === "available" ? (
                <div className="flex shrink-0 items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Launch agent in ${project.name}`}
                        onClick={() => onLaunch(project)}
                      >
                        <Bot />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Launch agent</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Open ${project.name}`}
                        onClick={() => onOpen(project)}
                      >
                        <ArrowRight />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Open project</TooltipContent>
                  </Tooltip>
                </div>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Forget ${project.name}`}
                      onClick={() => onForget(project)}
                    >
                      <Trash2 />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Forget project</TooltipContent>
                </Tooltip>
              )}
            </Item>
          ))}
        </ItemGroup>
      )}
    </section>
  )
}

function HqSkeleton() {
  return (
    <div
      className="flex h-full flex-col bg-background"
      data-yaade-boot="hq-loading"
      role="status"
    >
      <span className="sr-only">Loading HQ…</span>
      <div className="flex h-11 items-center gap-3 border-b px-4" data-yaade-app-header="">
        <Skeleton className="size-5" />
        <Skeleton className="h-4 w-28" />
      </div>
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-4 p-4 sm:p-5 lg:p-6">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map(index => (
            <Skeleton key={index} className="h-32" />
          ))}
        </div>
        <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.65fr)_minmax(20rem,0.65fr)]">
          <Skeleton className="h-96" />
          <Skeleton className="h-80" />
        </div>
      </div>
    </div>
  )
}
