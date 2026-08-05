import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react"
import type { ProjectSessionSummary } from "@yaade/rpc"
import type { GitCommit, GitRepositorySummary, GitWorktree } from "@yaade/shared"
import { pathToFileUri } from "@yaade/shared"
import {
  AppShell,
  SectionLabel,
  Text,
  bundledThemeList,
} from "@yaade/ui"
import {
  Badge,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@yaade/ui/primitives"
import { GitBranchIcon, PlusIcon, SettingsIcon } from "lucide-react"
import { useAppearanceSettings } from "../hooks/useAppearanceSettings.js"
import { workspaceDocumentTitle } from "../url-workspace.js"
import {
  archiveProjectSession,
  createProjectSession,
  deleteProjectSession,
  renameProjectSession,
} from "../project-session-client.js"
import { NewSessionDialog } from "./NewSessionDialog.js"
import { ProjectAboutRail } from "./ProjectAboutRail.js"
import { SessionList } from "./SessionList.js"

const GitWorkspace = lazy(() =>
  import("@yaade/ui/git").then(m => ({ default: m.GitWorkspace })),
)
const SettingsOverlay = lazy(() =>
  import("@yaade/ui").then(m => ({ default: m.SettingsOverlay })),
)

export type ProjectPageProps = {
  projectPath: string
  homeDir: string
  machineHostname: string
  onOpenSession: (sessionId: string) => Promise<void>
  listSessions: () => Promise<ProjectSessionSummary[]>
}

function formatRelative(iso: string): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return ""
  const delta = Date.now() - then
  const minutes = Math.round(delta / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(then).toLocaleDateString()
}

export function ProjectPage({
  projectPath,
  homeDir,
  onOpenSession,
  listSessions,
}: ProjectPageProps) {
  const {
    appearanceSettings,
    setAppearanceSettings,
    activeTheme,
    resetAppearanceSettings,
  } = useAppearanceSettings()
  const [sessions, setSessions] = useState<ProjectSessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState("sessions")
  const [newOpen, setNewOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [summary, setSummary] = useState<GitRepositorySummary | null>(null)
  const [dirtyCount, setDirtyCount] = useState(0)
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([])
  const [recentCommits, setRecentCommits] = useState<GitCommit[]>([])
  const rootUri = useMemo(() => pathToFileUri(projectPath), [projectPath])
  const title = workspaceDocumentTitle(projectPath, homeDir)
  const crumbs = useMemo(() => {
    const home = homeDir.replace(/\/+$/, "")
    if (home && projectPath.startsWith(`${home}/`)) {
      return ["~", ...projectPath.slice(home.length + 1).split("/").filter(Boolean)]
    }
    return projectPath.split("/").filter(Boolean)
  }, [homeDir, projectPath])

  const refreshSessions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await listSessions()
      setSessions(rows.filter(s => !s.archivedAt))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [listSessions])

  const refreshGit = useCallback(async () => {
    const git = window.yaade?.git
    if (!git) return
    try {
      const isRepo = await git.isRepo(rootUri)
      if (!isRepo) {
        setSummary(null)
        setDirtyCount(0)
        setWorktrees([])
        setRecentCommits([])
        return
      }
      const [sum, status, trees, history] = await Promise.all([
        git.summary(rootUri),
        git.status(rootUri),
        git.worktreeList(rootUri).catch(() => [] as GitWorktree[]),
        git.history(rootUri, 5).catch(() => [] as GitCommit[]),
      ])
      setSummary(sum)
      setDirtyCount(status.length)
      setWorktrees(trees)
      setRecentCommits(history)
    } catch {
      /* non-git project */
    }
  }, [rootUri])

  useEffect(() => {
    void refreshSessions()
    void refreshGit()
  }, [refreshGit, refreshSessions])

  useEffect(() => {
    document.title = title
  }, [title])

  const handleCreate = useCallback(
    async (input: {
      title: string
      worktree?: { branch: string; baseRef?: string }
    }) => {
      const created = await createProjectSession({
        rootPath: projectPath,
        title: input.title,
        worktree: input.worktree,
      })
      setNewOpen(false)
      await onOpenSession(created.id)
    },
    [onOpenSession, projectPath],
  )

  return (
    <AppShell>
      <div
        className="flex h-full min-h-0 w-full flex-col bg-background"
        data-yaade-shell="project"
        data-yaade-project-path={projectPath}
      >
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <nav
            className="flex min-w-0 flex-1 items-center gap-1 text-sm"
            aria-label="Project path"
            data-yaade-project-breadcrumb=""
          >
            {crumbs.map((part, i) => (
              <span key={`${part}-${i}`} className="flex items-center gap-1">
                {i > 0 ? (
                  <span className="text-muted-foreground">/</span>
                ) : null}
                <span
                  className={
                    i === crumbs.length - 1
                      ? "truncate font-semibold text-foreground"
                      : "truncate text-muted-foreground"
                  }
                >
                  {part}
                </span>
              </span>
            ))}
          </nav>
          {summary?.branch ? (
            <Badge variant="secondary" className="gap-1 font-mono">
              <GitBranchIcon className="size-3" />
              {summary.branch}
            </Badge>
          ) : null}
          {dirtyCount > 0 ? (
            <Badge variant="outline">{dirtyCount} changes</Badge>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <SettingsIcon className="size-4" />
          </Button>
          <Button
            size="sm"
            data-yaade-new-session=""
            onClick={() => setNewOpen(true)}
          >
            <PlusIcon className="size-4" />
            New session
          </Button>
        </header>

        <Tabs
          value={tab}
          onValueChange={setTab}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="border-b border-border px-4">
            <TabsList variant="line">
              <TabsTrigger value="sessions" data-yaade-project-tab="sessions">
                Sessions
              </TabsTrigger>
              <TabsTrigger value="changes" data-yaade-project-tab="changes">
                Changes
              </TabsTrigger>
              <TabsTrigger value="history" data-yaade-project-tab="history">
                History
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent
            value="sessions"
            className="min-h-0 flex-1 overflow-hidden p-0"
          >
            <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_16rem]">
              <main className="min-h-0 overflow-auto p-4 md:p-6">
                <SectionLabel>Recent sessions</SectionLabel>
                {loading ? (
                  <p className="text-sm text-muted-foreground" role="status">
                    Loading sessions…
                  </p>
                ) : error ? (
                  <div role="alert" className="rounded-md border border-border p-4">
                    <Text variant="label">Sessions unavailable</Text>
                    <p className="mt-1 text-sm text-muted-foreground">{error}</p>
                    <Button
                      className="mt-3"
                      size="sm"
                      onClick={() => void refreshSessions()}
                    >
                      Retry
                    </Button>
                  </div>
                ) : sessions.length === 0 ? (
                  <Empty className="border border-dashed border-border">
                    <EmptyHeader>
                      <EmptyTitle>No sessions yet</EmptyTitle>
                      <EmptyDescription>
                        Create a session to start a tiling workspace on this
                        project. Optionally back it with a git worktree.
                      </EmptyDescription>
                    </EmptyHeader>
                    <Button
                      className="mt-2"
                      size="sm"
                      onClick={() => setNewOpen(true)}
                    >
                      New session
                    </Button>
                  </Empty>
                ) : (
                  <SessionList
                    sessions={sessions}
                    formatRelative={formatRelative}
                    onOpen={id => void onOpenSession(id)}
                    onRename={async (id, nextTitle) => {
                      await renameProjectSession(id, nextTitle)
                      await refreshSessions()
                    }}
                    onArchive={async id => {
                      await archiveProjectSession(id, true)
                      await refreshSessions()
                    }}
                    onDelete={async (id, removeWorktree) => {
                      await deleteProjectSession(id, { removeWorktree })
                      await refreshSessions()
                      void refreshGit()
                    }}
                  />
                )}

                {recentCommits.length > 0 ? (
                  <div className="mt-8">
                    <SectionLabel>Recent commits</SectionLabel>
                    <ul className="divide-y divide-border rounded-md border border-border">
                      {recentCommits.map(commit => (
                        <li
                          key={commit.hash}
                          className="flex items-start gap-3 px-3 py-2"
                          data-yaade-recent-commit=""
                        >
                          <span className="font-mono text-3xs text-muted-foreground">
                            {commit.shortHash}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm">{commit.subject}</p>
                            <p className="text-3xs text-muted-foreground">
                              {commit.author}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </main>
              <ProjectAboutRail
                summary={summary}
                dirtyCount={dirtyCount}
                worktrees={worktrees}
                projectPath={projectPath}
              />
            </div>
          </TabsContent>

          <TabsContent
            value="changes"
            className="min-h-0 flex-1 overflow-hidden p-0"
          >
            <Suspense fallback={null}>
              <GitWorkspace
                rootUri={rootUri}
                theme={activeTheme}
                initialView="changes"
                onOpenFile={() => undefined}
              />
            </Suspense>
          </TabsContent>

          <TabsContent
            value="history"
            className="min-h-0 flex-1 overflow-hidden p-0"
          >
            <Suspense fallback={null}>
              <GitWorkspace
                rootUri={rootUri}
                theme={activeTheme}
                initialView="history"
                onOpenFile={() => undefined}
              />
            </Suspense>
          </TabsContent>
        </Tabs>
      </div>

      <NewSessionDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        projectPath={projectPath}
        homeDir={homeDir}
        defaultBranch={summary?.branch ?? "main"}
        onCreate={handleCreate}
      />

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
