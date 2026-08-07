import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { ProjectSession, ProjectSessionSummary } from "@yaade/rpc"
import type { GitRepositorySummary } from "@yaade/shared"
import { pathToFileUri } from "@yaade/shared"
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
import { useSystemSignals } from "../system-signals/SystemSignalsProvider.js"
import { preloadMuxApp } from "../mux/preload.js"
import type {
  MuxLaunchAction,
  MuxLaunchRequest,
} from "../mux/MuxApp.js"
import { workspaceDocumentTitle } from "../url-workspace.js"
import {
  createProjectSession,
  openCheckoutSession,
} from "../project-session-client.js"
import { ProjectOverview } from "./ProjectOverview.js"
import { ProjectPathSwitcher } from "./ProjectPathSwitcher.js"
import { WorktreeSwitcher } from "./WorktreeSwitcher.js"

const GitWorkspace = lazy(() =>
  import("@yaade/ui/git").then(m => ({ default: m.GitWorkspace })),
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
const AgentCliPickerOverlay = lazy(() =>
  import("@yaade/ui/agent-picker").then(m => ({
    default: m.AgentCliPickerOverlay,
  })),
)

export type ProjectPageProps = {
  projectId: string
  projectName: string
  projectPath: string
  homeDir: string
  machineHostname: string
  /** Active session — tiling workspace renders in-page when set. */
  session: ProjectSession | null
  /** One-shot launch requested from HQ before navigating into this project. */
  agentLaunchIntent?: {
    id: string
    driverId: Extract<MuxLaunchAction, { kind: "agent" }>["driverId"]
  } | null
  onAgentLaunchIntentHandled?: (intentId: string) => void
  onOpenSession: (sessionId: string) => Promise<void>
  /** Clear the active session (leave worktree view, keep project chrome). */
  onClearSession?: () => void
  onNavigateProject: (absolutePath: string) => void
  onOpenHq: () => void
  listSessions: () => Promise<ProjectSessionSummary[]>
}

/** Visible tabs are Overview / History; `worktree` is selected only via the Worktrees menu. */
type ProjectView = "overview" | "history" | "worktree"

export function ProjectPage({
  projectId,
  projectName,
  projectPath,
  homeDir,
  machineHostname,
  session,
  agentLaunchIntent = null,
  onAgentLaunchIntentHandled,
  onOpenSession,
  onClearSession,
  onNavigateProject,
  onOpenHq,
  listSessions,
}: ProjectPageProps) {
  const notifications = useSystemSignals()
  const {
    appearanceSettings,
    setAppearanceSettings,
    activeTheme,
    resetAppearanceSettings,
  } = useAppearanceSettings()
  const [view, setView] = useState<ProjectView>(
    session ? "worktree" : "overview",
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [historyMounted, setHistoryMounted] = useState(false)
  const [summary, setSummary] = useState<GitRepositorySummary | null>(null)
  const [launchRequest, setLaunchRequest] = useState<MuxLaunchRequest | null>(null)
  const [agentPickerOpen, setAgentPickerOpen] = useState(false)
  const launchSequenceRef = useRef(0)
  const handledAgentLaunchIntentsRef = useRef(new Set<string>())
  const rootUri = useMemo(() => pathToFileUri(projectPath), [projectPath])
  const title = workspaceDocumentTitle(projectPath, homeDir)

  useEffect(() => {
    document.title = title
  }, [title])

  // Opening / restoring a session shows the in-page tiling workspace.
  useEffect(() => {
    if (session) setView("worktree")
    else setView(current => (current === "worktree" ? "overview" : current))
  }, [session?.id]) // eslint-disable-line react-hooks/exhaustive-deps -- session identity only

  const handleSelectCheckout = useCallback(
    async (input: {
      cwdPath: string
      title?: string
      worktreeBranch?: string | null
      worktreePath?: string | null
    }) => {
      const muxReady = preloadMuxApp()
      const next = await openCheckoutSession({
        rootPath: projectPath,
        cwdPath: input.cwdPath,
        title: input.title,
        worktreeBranch: input.worktreeBranch,
        worktreePath: input.worktreePath,
      })
      await muxReady
      setView("worktree")
      await onOpenSession(next.id)
    },
    [onOpenSession, projectPath],
  )

  const handleCreateWorktree = useCallback(
    async (input: { branch: string; baseRef?: string }) => {
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
      setView("worktree")
      await onOpenSession(created.id)
    },
    [onOpenSession, projectPath],
  )

  const resumeWorkspace = useCallback(async () => {
    if (session) {
      setView("worktree")
      return
    }
    await handleSelectCheckout({ cwdPath: projectPath, title: "Main" })
  }, [handleSelectCheckout, projectPath, session])

  const handleLaunchAction = useCallback(
    async (action: MuxLaunchAction) => {
      launchSequenceRef.current += 1
      const request: MuxLaunchRequest = {
        id: `launch-${Date.now()}-${launchSequenceRef.current}`,
        action,
      }
      setLaunchRequest(request)
      try {
        if (session) {
          setView("worktree")
          return
        }
        await handleSelectCheckout({ cwdPath: projectPath, title: "Main" })
      } catch (error) {
        setLaunchRequest(current => (current?.id === request.id ? null : current))
        showYaadeToast(
          error instanceof Error ? error.message : "Could not open the workspace.",
          { variant: "destructive" },
        )
      }
    },
    [handleSelectCheckout, projectPath, session],
  )

  const handleLaunchRequestHandled = useCallback((requestId: string) => {
    setLaunchRequest(current => (current?.id === requestId ? null : current))
  }, [])

  useEffect(() => {
    if (!agentLaunchIntent) return
    if (handledAgentLaunchIntentsRef.current.has(agentLaunchIntent.id)) return
    handledAgentLaunchIntentsRef.current.add(agentLaunchIntent.id)
    void handleLaunchAction({
      kind: "agent",
      driverId: agentLaunchIntent.driverId,
    }).finally(() => onAgentLaunchIntentHandled?.(agentLaunchIntent.id))
  }, [agentLaunchIntent, handleLaunchAction, onAgentLaunchIntentHandled])

  const handleResumeSession = useCallback(
    async (sessionId: string) => {
      const muxReady = preloadMuxApp()
      await muxReady
      setView("worktree")
      await onOpenSession(sessionId)
    },
    [onOpenSession],
  )

  // Radix Tabs only knows Overview / History; worktree view leaves both inactive.
  const tabsValue = view === "worktree" ? "none" : view

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
          <header className="flex h-8 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border px-2.5">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Open HQ"
              onClick={onOpenHq}
            >
              <House className="size-3.5" />
            </Button>
            <ProjectPathSwitcher
              projectPath={projectPath}
              homeDir={homeDir}
              onNavigate={onNavigateProject}
            />
            <div className="flex h-6 shrink-0 items-center gap-0">
              <TabsList variant="line" className="h-6 gap-0 p-0">
                <TabsTrigger
                  value="overview"
                  data-yaade-project-tab="overview"
                  className="px-1.5 text-xs"
                >
                  Overview
                </TabsTrigger>
              </TabsList>
              <WorktreeSwitcher
                projectPath={projectPath}
                homeDir={homeDir}
                defaultBranch={summary?.branch ?? "main"}
                active={view === "worktree" && session != null}
                activeLabel={
                  session
                    ? (session.worktreeBranch ??
                      (session.cwdPath === projectPath
                        ? "Main"
                        : session.title))
                    : null
                }
                activeCwdPath={session?.cwdPath ?? null}
                onIntent={() => void preloadMuxApp()}
                onSelectCheckout={handleSelectCheckout}
                onCreateWorktree={handleCreateWorktree}
              />
              <TabsList variant="line" className="h-6 gap-0 p-0">
                <TabsTrigger
                  value="history"
                  data-yaade-project-tab="history"
                  className="px-1.5 text-xs"
                >
                  History
                </TabsTrigger>
              </TabsList>
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
                <SettingsIcon className="size-3.5" />
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
                homeDir={homeDir}
                active={view === "overview"}
                listSessions={listSessions}
                onLaunchAgent={() => setAgentPickerOpen(true)}
                onLaunchAction={handleLaunchAction}
                onResumeWorkspace={resumeWorkspace}
                onResumeSession={handleResumeSession}
                onOpenCheckout={handleSelectCheckout}
                onCreateWorktree={handleCreateWorktree}
                onRepositorySummary={setSummary}
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

            {session ? (
              <div
                className={cn(
                  "absolute inset-0 overflow-hidden",
                  view !== "worktree" && "pointer-events-none invisible",
                )}
                aria-hidden={view !== "worktree"}
                data-yaade-project-panel="worktree"
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
                    onBackToProject={onClearSession}
                    launchRequest={launchRequest}
                    onLaunchRequestHandled={handleLaunchRequestHandled}
                  />
                </Suspense>
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
      {!session ? <Toaster position="bottom-right" /> : null}
    </AppShell>
  )
}
