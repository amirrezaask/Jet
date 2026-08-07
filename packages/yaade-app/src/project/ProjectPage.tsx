import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
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
import { SettingsIcon } from "lucide-react"
import { useAppearanceSettings } from "../hooks/useAppearanceSettings.js"
import { preloadMuxApp } from "../mux/preload.js"
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

export type ProjectPageProps = {
  projectPath: string
  homeDir: string
  machineHostname: string
  /** Active session — tiling workspace renders in-page when set. */
  session: ProjectSession | null
  onOpenSession: (sessionId: string) => Promise<void>
  /** Clear the active session (leave worktree view, keep project chrome). */
  onClearSession?: () => void
  onNavigateProject: (absolutePath: string) => void
  listSessions: () => Promise<ProjectSessionSummary[]>
}

/** Visible tabs are Overview / History; `worktree` is selected only via the Worktrees menu. */
type ProjectView = "overview" | "history" | "worktree"

export function ProjectPage({
  projectPath,
  homeDir,
  machineHostname,
  session,
  onOpenSession,
  onClearSession,
  onNavigateProject,
}: ProjectPageProps) {
  const {
    appearanceSettings,
    setAppearanceSettings,
    activeTheme,
    fontSize,
    resetAppearanceSettings,
  } = useAppearanceSettings()
  const [view, setView] = useState<ProjectView>(
    session ? "worktree" : "overview",
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [historyMounted, setHistoryMounted] = useState(false)
  const [summary, setSummary] = useState<GitRepositorySummary | null>(null)
  const rootUri = useMemo(() => pathToFileUri(projectPath), [projectPath])
  const title = workspaceDocumentTitle(projectPath, homeDir)

  const refreshGit = useCallback(async () => {
    const git = window.yaade?.git
    if (!git) return
    try {
      const isRepo = await git.isRepo(rootUri)
      if (!isRepo) {
        setSummary(null)
        return
      }
      setSummary(await git.summary(rootUri))
    } catch {
      /* non-git project */
    }
  }, [rootUri])

  useEffect(() => {
    void refreshGit()
  }, [refreshGit])

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
                theme={activeTheme}
                fontSize={fontSize}
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
                    homeDir={homeDir}
                    machineHostname={machineHostname}
                    embedded
                    onBackToProject={onClearSession}
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
    </AppShell>
  )
}
