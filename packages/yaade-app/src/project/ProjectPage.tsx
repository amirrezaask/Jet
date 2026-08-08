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
import { useSystemSignals } from "../system-signals/SystemSignalsProvider.js"
import { preloadMuxApp } from "../mux/preload.js"
import type {
  MuxLaunchAction,
  MuxLaunchRequest,
} from "../mux/MuxApp.js"
import { workspaceDocumentTitle } from "../url-workspace.js"
import { openCheckoutSession } from "../project-session-client.js"
import { ProjectOverview } from "./ProjectOverview.js"
import { ProjectPathSwitcher } from "./ProjectPathSwitcher.js"

const GitWorkspace = lazy(() =>
  import("@yaade/ui/git").then(m => ({ default: m.GitWorkspace })),
)
const CommitChangesDialog = lazy(() =>
  import("@yaade/ui/commit-changes").then(m => ({
    default: m.CommitChangesDialog,
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

/** Visible tabs are Overview / History; an active session renders the workspace view. */
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
  const [selectedCommit, setSelectedCommit] = useState<GitCommit | null>(null)
  const [launchRequest, setLaunchRequest] = useState<MuxLaunchRequest | null>(null)
  const launchSequenceRef = useRef(0)
  const handledAgentLaunchIntentsRef = useRef(new Set<string>())
  const rootUri = useMemo(() => pathToFileUri(projectPath), [projectPath])
  const title = workspaceDocumentTitle(projectPath, homeDir)

  useEffect(() => {
    document.title = title
  }, [title])

  useEffect(() => {
    setSelectedCommit(null)
  }, [projectPath])

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

  const showHistory = useCallback(() => {
    setHistoryMounted(true)
    setView("history")
  }, [])

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
