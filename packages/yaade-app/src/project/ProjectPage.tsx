import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type {
  HqAgentSummary,
  ProjectSession,
  ProjectSessionSummary,
} from "@yaade/rpc"
import { pathToFileUri, type GitCommit } from "@yaade/shared"
import {
  AppShell,
  cn,
} from "@yaade/ui/project"
import { bundledThemeList } from "@yaade/ui/appearance"
import {
  Button,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@yaade/ui/primitives"
import { showYaadeToast, Toaster } from "@yaade/ui/toast"
import { NotificationBell } from "@yaade/ui/notifications"
import { House, SettingsIcon } from "lucide-react"
import { useAppearanceSettings } from "../hooks/useAppearanceSettings.js"
import { useHqOverview } from "../hooks/useHqOverview.js"
import { useSystemSignals } from "../system-signals/SystemSignalsProvider.js"
import { preloadMuxApp } from "../mux/preload.js"
import type {
  MuxLaunchAction,
  MuxLaunchRequest,
  MuxSurface,
} from "../mux/MuxApp.js"
import { workspaceDocumentTitle } from "../url-workspace.js"
import {
  createProjectSession,
  openCheckoutSession,
} from "../project-session-client.js"
import {
  clearHqAgentLaunch,
  peekHqAgentLaunch,
} from "./hq-agent-launch.js"
import { AgentSwitcher } from "./AgentSwitcher.js"
import { ProjectOverview } from "./ProjectOverview.js"
import { ProjectPathSwitcher } from "./ProjectPathSwitcher.js"
import { WorktreeSwitcher } from "./WorktreeSwitcher.js"
import { isAccessibleHqAgent } from "../hq/hq-model.js"

const GitWorkspace = lazy(() =>
  import("@yaade/ui/git").then(m => ({ default: m.GitWorkspace })),
)
const CommitChangesDialog = lazy(() =>
  import("@yaade/ui/commit-changes").then(m => ({
    default: m.CommitChangesDialog,
  })),
)
const AgentCliPickerOverlay = lazy(() =>
  import("@yaade/ui/agent-picker").then(m => ({
    default: m.AgentCliPickerOverlay,
  })),
)

function preloadSettingsOverlay() {
  return import("@yaade/ui/settings")
}

const MuxApp = lazy(() =>
  preloadMuxApp().then(m => ({ default: m.MuxApp })),
)
const SettingsOverlay = lazy(() =>
  preloadSettingsOverlay().then(m => ({ default: m.SettingsOverlay })),
)

export type ProjectPageProps = {
  projectId: string
  projectName: string
  projectPath: string
  homeDir: string
  machineHostname: string
  /** Active session — surface workspace renders in-page when set. */
  session: ProjectSession | null
  /** One-shot launch requested from HQ before navigating into this project. */
  agentLaunchIntent?: {
    id: string
    driverId: Extract<MuxLaunchAction, { kind: "agent" }>["driverId"]
  } | null
  onAgentLaunchIntentHandled?: (intentId: string) => void
  /** Focus a specific agent leaf when opening from HQ agent list. */
  initialAgentFocusTabId?: string | null
  onInitialAgentFocusHandled?: () => void
  onOpenSession: (sessionId: string) => Promise<void>
  /** Clear the active session (leave surface view, keep project chrome). */
  onClearSession?: () => void
  onNavigateProject: (absolutePath: string) => void
  onOpenHq: () => void
  listSessions: () => Promise<ProjectSessionSummary[]>
}

type ProjectView =
  | "overview"
  | "history"
  | "agents"
  | "editors"
  | "terminals"
  | "changes"

type ChangesCheckout = {
  cwdPath: string
  label: string
}

function isSurfaceView(view: ProjectView): view is MuxSurface {
  return view === "agents" || view === "editors" || view === "terminals"
}

function surfaceForView(view: ProjectView): MuxSurface | null {
  return isSurfaceView(view) ? view : null
}

function checkoutLabel(
  session: ProjectSession | null,
  projectPath: string,
): string | null {
  if (!session) return null
  return (
    session.worktreeBranch ??
    (session.cwdPath === projectPath ? "Main" : session.title)
  )
}

function changesCheckoutLabel(
  checkout: ChangesCheckout | null,
  projectPath: string,
): string | null {
  if (!checkout) return null
  if (checkout.cwdPath === projectPath) return "Main"
  return checkout.label
}

export function ProjectPage({
  projectId,
  projectName,
  projectPath,
  homeDir,
  machineHostname,
  session,
  agentLaunchIntent = null,
  onAgentLaunchIntentHandled,
  initialAgentFocusTabId = null,
  onInitialAgentFocusHandled,
  onOpenSession,
  onClearSession,
  onNavigateProject,
  onOpenHq,
  listSessions,
}: ProjectPageProps) {
  const notifications = useSystemSignals()
  const hq = useHqOverview()
  const {
    appearanceSettings,
    setAppearanceSettings,
    activeTheme,
    resetAppearanceSettings,
  } = useAppearanceSettings()
  const [view, setView] = useState<ProjectView>(
    session ? "terminals" : "overview",
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [historyMounted, setHistoryMounted] = useState(false)
  const [changesMounted, setChangesMounted] = useState(false)
  const [changesCheckout, setChangesCheckout] = useState<ChangesCheckout | null>(
    null,
  )
  const [selectedCommit, setSelectedCommit] = useState<GitCommit | null>(null)
  const [defaultBranch, setDefaultBranch] = useState("main")
  const [focusAgentTabId, setFocusAgentTabId] = useState<string | null>(
    initialAgentFocusTabId,
  )
  const [agentPickerOpen, setAgentPickerOpen] = useState(false)
  // Seed from the module queue so StrictMode remounts still see the HQ intent.
  const [launchRequest, setLaunchRequest] = useState<MuxLaunchRequest | null>(
    () => {
      const queued = peekHqAgentLaunch(projectId)
      return queued
        ? {
            id: queued.id,
            action: { kind: "agent", driverId: queued.driverId },
          }
        : null
    },
  )
  const launchSequenceRef = useRef(0)
  const preferredSurfaceRef = useRef<MuxSurface | null>(
    session ? "terminals" : null,
  )
  const rootUri = useMemo(() => pathToFileUri(projectPath), [projectPath])
  const title = workspaceDocumentTitle(projectPath, homeDir)

  const projectAgents = useMemo(
    () =>
      (hq.snapshot?.agents ?? []).filter(
        agent =>
          (agent.projectId === projectId || agent.projectPath === projectPath) &&
          isAccessibleHqAgent(agent),
      ),
    [hq.snapshot?.agents, projectId, projectPath],
  )

  const activeAgent = useMemo(
    () =>
      focusAgentTabId
        ? (projectAgents.find(a => a.sessionId === focusAgentTabId) ?? null)
        : null,
    [focusAgentTabId, projectAgents],
  )

  useEffect(() => {
    if (!focusAgentTabId) return
    if (projectAgents.some(agent => agent.sessionId === focusAgentTabId)) return
    setFocusAgentTabId(null)
  }, [focusAgentTabId, projectAgents])

  useEffect(() => {
    document.title = title
  }, [title])

  useEffect(() => {
    setSelectedCommit(null)
    setDefaultBranch("main")
    setChangesCheckout(null)
    setChangesMounted(false)
  }, [projectPath])

  useEffect(() => {
    let cancelled = false
    void window.yaade?.git
      ?.defaultBranch(rootUri)
      .then(branch => {
        if (!cancelled && branch?.trim()) setDefaultBranch(branch.trim())
      })
      .catch(() => {
        /* keep "main" fallback */
      })
    return () => {
      cancelled = true
    }
  }, [rootUri])

  // Opening / restoring a session shows the preferred surface (default Terminals).
  useEffect(() => {
    if (session) {
      const preferred = preferredSurfaceRef.current ?? "terminals"
      setView(current =>
        current === "overview" || current === "history" ? preferred : current,
      )
    } else {
      preferredSurfaceRef.current = null
      setFocusAgentTabId(null)
      setView(current => (isSurfaceView(current) ? "overview" : current))
    }
  }, [session?.id]) // eslint-disable-line react-hooks/exhaustive-deps -- session identity only

  useEffect(() => {
    if (!initialAgentFocusTabId) return
    preferredSurfaceRef.current = "agents"
    setFocusAgentTabId(initialAgentFocusTabId)
    setView("agents")
    onInitialAgentFocusHandled?.()
  }, [initialAgentFocusTabId, onInitialAgentFocusHandled])

  const openCheckoutForSurface = useCallback(
    async (
      surface: MuxSurface,
      input: {
        cwdPath: string
        title?: string
        worktreeBranch?: string | null
        worktreePath?: string | null
      },
    ) => {
      preferredSurfaceRef.current = surface
      const muxReady = preloadMuxApp()
      const next = await openCheckoutSession({
        rootPath: projectPath,
        cwdPath: input.cwdPath,
        title: input.title,
        worktreeBranch: input.worktreeBranch,
        worktreePath: input.worktreePath,
      })
      await muxReady
      setView(surface)
      await onOpenSession(next.id)
    },
    [onOpenSession, projectPath],
  )

  const handleSelectCheckout = useCallback(
    async (
      surface: "editors" | "terminals",
      input: {
        cwdPath: string
        title?: string
        worktreeBranch?: string | null
        worktreePath?: string | null
      },
    ) => {
      try {
        await openCheckoutForSurface(surface, input)
      } catch (error) {
        showYaadeToast(
          error instanceof Error ? error.message : "Could not open the workspace.",
          { variant: "destructive" },
        )
      }
    },
    [openCheckoutForSurface],
  )

  const handleCreateWorktree = useCallback(
    async (
      surface: "editors" | "terminals",
      input: { branch: string; baseRef?: string },
    ) => {
      preferredSurfaceRef.current = surface
      try {
        const muxReady = preloadMuxApp()
        const created = await createProjectSession({
          rootPath: projectPath,
          title: input.branch,
          worktree: {
            branch: input.branch,
            baseRef: input.baseRef,
          },
        })
        await muxReady
        setView(surface)
        await onOpenSession(created.id)
      } catch (error) {
        showYaadeToast(
          error instanceof Error
            ? error.message
            : "Could not create the worktree.",
          { variant: "destructive" },
        )
      }
    },
    [onOpenSession, projectPath],
  )

  const handleSelectAgent = useCallback(
    async (agent: HqAgentSummary) => {
      preferredSurfaceRef.current = "agents"
      setFocusAgentTabId(agent.sessionId)
      const muxReady = preloadMuxApp()
      await muxReady
      setView("agents")
      await onOpenSession(agent.projectSessionId)
    },
    [onOpenSession],
  )

  const handleLaunchAction = useCallback(
    async (action: MuxLaunchAction) => {
      launchSequenceRef.current += 1
      const request: MuxLaunchRequest = {
        id: `launch-${Date.now()}-${launchSequenceRef.current}`,
        action,
      }
      setLaunchRequest(request)
      const surface: MuxSurface =
        action.kind === "agent"
          ? "agents"
          : action.kind === "editor"
            ? "editors"
            : "terminals"
      preferredSurfaceRef.current = surface
      try {
        if (session) {
          setView(surface)
          return
        }
        await openCheckoutForSurface(surface, {
          cwdPath: projectPath,
          title: "Main",
        })
      } catch (error) {
        setLaunchRequest(current => (current?.id === request.id ? null : current))
        showYaadeToast(
          error instanceof Error ? error.message : "Could not open the workspace.",
          { variant: "destructive" },
        )
      }
    },
    [openCheckoutForSurface, projectPath, session],
  )

  const handleLaunchRequestHandled = useCallback(
    (requestId: string, result?: { agentTabId?: string | null }) => {
      clearHqAgentLaunch(requestId)
      setLaunchRequest(current => (current?.id === requestId ? null : current))
      onAgentLaunchIntentHandled?.(requestId)
      if (result?.agentTabId) {
        setFocusAgentTabId(result.agentTabId)
        setView("agents")
        preferredSurfaceRef.current = "agents"
      }
    },
    [onAgentLaunchIntentHandled],
  )

  // HQ launch intents must survive StrictMode remounts. Keep the stable intent
  // id on `launchRequest` and only clear after Mux confirms the pane opened.
  useEffect(() => {
    const queued = peekHqAgentLaunch(projectId)
    const intent =
      agentLaunchIntent ??
      (queued
        ? { id: queued.id, driverId: queued.driverId }
        : null)
    if (!intent) return

    preferredSurfaceRef.current = "agents"
    setLaunchRequest({
      id: intent.id,
      action: { kind: "agent", driverId: intent.driverId },
    })

    if (session) {
      setView("agents")
      return
    }

    let cancelled = false
    void openCheckoutForSurface("agents", {
      cwdPath: projectPath,
      title: "Main",
    }).catch(error => {
      if (cancelled) return
      clearHqAgentLaunch(intent.id)
      setLaunchRequest(current =>
        current?.id === intent.id ? null : current,
      )
      onAgentLaunchIntentHandled?.(intent.id)
      showYaadeToast(
        error instanceof Error
          ? error.message
          : "Could not open the workspace for agent launch.",
        { variant: "destructive" },
      )
    })
    return () => {
      cancelled = true
    }
  }, [
    agentLaunchIntent,
    onAgentLaunchIntentHandled,
    openCheckoutForSurface,
    projectId,
    projectPath,
    session,
  ])

  const handleResumeSession = useCallback(
    async (sessionId: string) => {
      preferredSurfaceRef.current = "terminals"
      const muxReady = preloadMuxApp()
      await muxReady
      setView("terminals")
      await onOpenSession(sessionId)
    },
    [onOpenSession],
  )

  const handleSelectChangesCheckout = useCallback(
    async (input: {
      cwdPath: string
      title?: string
      worktreeBranch?: string | null
      worktreePath?: string | null
    }) => {
      setChangesCheckout({
        cwdPath: input.cwdPath,
        label:
          input.worktreeBranch ??
          input.title ??
          (input.cwdPath === projectPath ? "Main" : input.cwdPath),
      })
      setChangesMounted(true)
      setView("changes")
    },
    [projectPath],
  )

  const handleCreateChangesWorktree = useCallback(
    async (input: { branch: string; baseRef?: string }) => {
      try {
        const created = await createProjectSession({
          rootPath: projectPath,
          title: input.branch,
          worktree: {
            branch: input.branch,
            baseRef: input.baseRef,
          },
        })
        setChangesCheckout({
          cwdPath: created.cwdPath,
          label: created.worktreeBranch ?? created.title,
        })
        setChangesMounted(true)
        setView("changes")
      } catch (error) {
        showYaadeToast(
          error instanceof Error
            ? error.message
            : "Could not create the worktree.",
          { variant: "destructive" },
        )
      }
    },
    [projectPath],
  )

  const showHistory = useCallback(() => {
    setHistoryMounted(true)
    setView("history")
  }, [])

  const showChanges = useCallback(() => {
    setChangesMounted(true)
    if (!changesCheckout) {
      setChangesCheckout({ cwdPath: projectPath, label: "Main" })
    }
    setView("changes")
  }, [changesCheckout, projectPath])

  const surface = surfaceForView(view)
  const muxSurface: MuxSurface =
    surface ?? preferredSurfaceRef.current ?? "terminals"
  const tabsValue =
    view === "overview" || view === "history" ? view : "none"
  const sessionCheckoutLabel = checkoutLabel(session, projectPath)
  const changesLabel = changesCheckoutLabel(changesCheckout, projectPath)
  const changesRootUri = useMemo(
    () =>
      pathToFileUri(changesCheckout?.cwdPath ?? projectPath),
    [changesCheckout?.cwdPath, projectPath],
  )

  return (
    <AppShell>
      <div
        className="flex h-full min-h-0 w-full flex-col bg-background"
        data-yaade-shell="project"
        data-yaade-project-path={projectPath}
      >
        <Tabs
          value={tabsValue}
          onValueChange={value => {
            if (value === "overview" || value === "history") {
              if (value === "history") setHistoryMounted(true)
              setView(value)
            }
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <header
            className="flex h-11 shrink-0 items-center gap-2 overflow-x-auto border-b border-border px-3 sm:px-4"
            data-yaade-app-header=""
          >
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Open HQ"
              onClick={onOpenHq}
            >
              <House />
            </Button>
            <ProjectPathSwitcher
              projectPath={projectPath}
              homeDir={homeDir}
              onNavigate={onNavigateProject}
            />
            <div className="flex h-7 shrink-0 items-center rounded-md border border-border bg-secondary/60 p-0.5">
              <TabsList variant="line" className="h-6 gap-0 p-0">
                <TabsTrigger
                  value="overview"
                  data-yaade-project-tab="overview"
                  className="px-2 text-xs"
                >
                  Overview
                </TabsTrigger>
                <TabsTrigger
                  value="history"
                  data-yaade-project-tab="history"
                  className="px-2 text-xs"
                >
                  History
                </TabsTrigger>
              </TabsList>
              <AgentSwitcher
                agents={projectAgents}
                loading={hq.loading && !hq.snapshot}
                error={hq.error}
                active={view === "agents"}
                activeAgentTabId={focusAgentTabId}
                activeLabel={activeAgent?.title ?? null}
                onIntent={() => {
                  void preloadMuxApp()
                  void hq.refresh()
                }}
                onOpenChange={open => {
                  if (open) void hq.refresh()
                }}
                onSelectAgent={handleSelectAgent}
                onLaunchAgent={() => setAgentPickerOpen(true)}
              />
              <WorktreeSwitcher
                tab="editors"
                label="Editors"
                projectPath={projectPath}
                homeDir={homeDir}
                defaultBranch={defaultBranch}
                active={view === "editors" && session != null}
                activeLabel={
                  view === "editors" ? sessionCheckoutLabel : null
                }
                activeCwdPath={
                  view === "editors" ? (session?.cwdPath ?? null) : null
                }
                onIntent={() => void preloadMuxApp()}
                onSelectCheckout={input =>
                  handleSelectCheckout("editors", input)
                }
                onCreateWorktree={input =>
                  handleCreateWorktree("editors", input)
                }
              />
              <WorktreeSwitcher
                tab="terminals"
                label="Terminals"
                projectPath={projectPath}
                homeDir={homeDir}
                defaultBranch={defaultBranch}
                active={view === "terminals" && session != null}
                activeLabel={
                  view === "terminals" ? sessionCheckoutLabel : null
                }
                activeCwdPath={
                  view === "terminals" ? (session?.cwdPath ?? null) : null
                }
                onIntent={() => void preloadMuxApp()}
                onSelectCheckout={input =>
                  handleSelectCheckout("terminals", input)
                }
                onCreateWorktree={input =>
                  handleCreateWorktree("terminals", input)
                }
              />
              <WorktreeSwitcher
                tab="changes"
                label="Changes"
                projectPath={projectPath}
                homeDir={homeDir}
                defaultBranch={defaultBranch}
                active={view === "changes"}
                activeLabel={view === "changes" ? changesLabel : null}
                activeCwdPath={changesCheckout?.cwdPath ?? null}
                onSelectCheckout={handleSelectChangesCheckout}
                onCreateWorktree={handleCreateChangesWorktree}
              />
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              <NotificationBell
                counts={notifications.counts}
                onClick={() => notifications.setOpen(true)}
                className="size-6"
              />
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Settings"
                onPointerEnter={() => void preloadSettingsOverlay()}
                onFocus={() => void preloadSettingsOverlay()}
                onClick={() => setSettingsOpen(true)}
              >
                <SettingsIcon />
              </Button>
            </div>
          </header>

          {/* Keep mux mounted so PTYs survive Overview/History switches. */}
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div
              className={cn(
                "absolute inset-0 overflow-hidden",
                view !== "overview" && "pointer-events-none invisible",
              )}
              aria-hidden={view !== "overview"}
              data-yaade-project-panel="overview"
            >
              <ProjectOverview
                projectPath={projectPath}
                active={view === "overview"}
                listSessions={listSessions}
                onLaunchAction={handleLaunchAction}
                onResumeSession={handleResumeSession}
                onOpenCommit={setSelectedCommit}
                onShowHistory={showHistory}
              />
            </div>

            {historyMounted ? (
              <div
                className={cn(
                  "absolute inset-0 overflow-hidden",
                  view !== "history" && "pointer-events-none invisible",
                )}
                aria-hidden={view !== "history"}
                data-yaade-project-panel="history"
              >
                <Suspense
                  fallback={
                    <div
                      className="grid h-full place-items-center text-xs text-muted-foreground"
                      role="status"
                    >
                      Loading history…
                    </div>
                  }
                >
                  <GitWorkspace
                    rootUri={rootUri}
                    theme={activeTheme}
                    initialView="history"
                    unifiedHistory
                    onOpenFile={() => undefined}
                  />
                </Suspense>
              </div>
            ) : null}

            {changesMounted ? (
              <div
                className={cn(
                  "absolute inset-0 overflow-hidden",
                  view !== "changes" && "pointer-events-none invisible",
                )}
                aria-hidden={view !== "changes"}
                data-yaade-project-panel="changes"
              >
                <Suspense
                  fallback={
                    <div
                      className="grid h-full place-items-center text-xs text-muted-foreground"
                      role="status"
                    >
                      Loading changes…
                    </div>
                  }
                >
                  <GitWorkspace
                    key={changesCheckout?.cwdPath ?? projectPath}
                    rootUri={changesRootUri}
                    theme={activeTheme}
                    initialView="changes"
                    onOpenFile={() => undefined}
                  />
                </Suspense>
              </div>
            ) : null}

            {view === "changes" && !changesMounted ? (
              <div
                className="absolute inset-0 grid place-items-center overflow-hidden"
                data-yaade-project-panel="changes"
              >
                <div className="max-w-sm px-4 text-center text-sm text-muted-foreground">
                  <p>Pick a worktree from Changes to review its diff.</p>
                  <Button
                    className="mt-3"
                    variant="secondary"
                    size="sm"
                    onClick={showChanges}
                  >
                    Open Main changes
                  </Button>
                </div>
              </div>
            ) : null}

            {session ? (
              <div
                className={cn(
                  "absolute inset-0 overflow-hidden",
                  !isSurfaceView(view) && "pointer-events-none invisible",
                )}
                aria-hidden={!isSurfaceView(view)}
                data-yaade-project-panel={muxSurface}
              >
                <Suspense
                  fallback={
                    <div
                      className="grid h-full place-items-center text-xs text-muted-foreground"
                      role="status"
                    >
                      Opening workspace…
                    </div>
                  }
                >
                  <MuxApp
                    key={session.id}
                    session={session}
                    projectId={projectId}
                    projectName={projectName}
                    homeDir={homeDir}
                    machineHostname={machineHostname}
                    embedded
                    surface={muxSurface}
                    focusAgentTabId={
                      muxSurface === "agents" ? focusAgentTabId : null
                    }
                    onBackToProject={onClearSession}
                    launchRequest={launchRequest}
                    onLaunchRequestHandled={handleLaunchRequestHandled}
                  />
                </Suspense>
              </div>
            ) : null}

            {view === "agents" && !session ? (
              <div
                className="absolute inset-0 grid place-items-center overflow-hidden"
                data-yaade-project-panel="agents"
              >
                <div className="max-w-sm px-4 text-center text-sm text-muted-foreground">
                  <p>Select a running agent from the Agents menu, or launch one.</p>
                  <Button
                    className="mt-3"
                    variant="secondary"
                    size="sm"
                    onClick={() => setAgentPickerOpen(true)}
                  >
                    Launch agent…
                  </Button>
                </div>
              </div>
            ) : null}

            {(view === "editors" || view === "terminals") && !session ? (
              <div
                className="absolute inset-0 grid place-items-center overflow-hidden"
                data-yaade-project-panel={view}
              >
                <p className="max-w-sm px-4 text-center text-sm text-muted-foreground">
                  {view === "editors"
                    ? "Pick a worktree from Editors to open files."
                    : "Pick a worktree from Terminals to open a shell."}
                </p>
              </div>
            ) : null}
          </div>
        </Tabs>
      </div>

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

      {agentPickerOpen ? (
        <Suspense fallback={null}>
          <AgentCliPickerOverlay
            open={agentPickerOpen}
            onOpenChange={setAgentPickerOpen}
            onSelect={driver => {
              setAgentPickerOpen(false)
              void handleLaunchAction({ kind: "agent", driverId: driver.id })
            }}
          />
        </Suspense>
      ) : null}

      {selectedCommit ? (
        <Suspense fallback={null}>
          <CommitChangesDialog
            open
            onOpenChange={open => {
              if (!open) setSelectedCommit(null)
            }}
            rootUri={rootUri}
            hash={selectedCommit.hash}
            theme={activeTheme}
            commit={selectedCommit}
          />
        </Suspense>
      ) : null}

      {!session ? <Toaster position="bottom-right" /> : null}
    </AppShell>
  )
}
