import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react"
import type { ProjectSessionSummary } from "@yaade/rpc"
import type { GitCommit, GitRepositorySummary } from "@yaade/shared"
import { pathToFileUri } from "@yaade/shared"
import {
  AppShell,
  SectionLabel,
  Text,
  bundledThemeList,
  showYaadeToast,
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
  saveProjectSessionPayload,
} from "../project-session-client.js"
import { NewSessionDialog } from "./NewSessionDialog.js"
import { ProjectPathSwitcher } from "./ProjectPathSwitcher.js"
import { ProjectSearchBox } from "./ProjectSearchBox.js"
import { SessionList } from "./SessionList.js"
import {
  buildNeovimQflistSessionPayload,
  formatSearchHitsAsQuickfix,
  writeQuickfixTempFile,
} from "./search-session.js"

const GitWorkspace = lazy(() =>
  import("@yaade/ui/git").then(m => ({ default: m.GitWorkspace })),
)
const CommitChangesDialog = lazy(() =>
  import("@yaade/ui/git").then(m => ({ default: m.CommitChangesDialog })),
)
const SettingsOverlay = lazy(() =>
  import("@yaade/ui").then(m => ({ default: m.SettingsOverlay })),
)

export type ProjectPageProps = {
  projectPath: string
  homeDir: string
  machineHostname: string
  onOpenSession: (sessionId: string) => Promise<void>
  onNavigateProject: (absolutePath: string) => void
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
  onNavigateProject,
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
  const [recentCommits, setRecentCommits] = useState<GitCommit[]>([])
  const [viewingCommit, setViewingCommit] = useState<GitCommit | null>(null)
  const [searchPending, setSearchPending] = useState(false)
  const rootUri = useMemo(() => pathToFileUri(projectPath), [projectPath])
  const title = workspaceDocumentTitle(projectPath, homeDir)

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
        setRecentCommits([])
        return
      }
      const [sum, status, history] = await Promise.all([
        git.summary(rootUri),
        git.status(rootUri),
        git.history(rootUri, 5).catch(() => [] as GitCommit[]),
      ])
      setSummary(sum)
      setDirtyCount(status.length)
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

  const handleProjectSearch = useCallback(
    async (query: string) => {
      const searchApi = window.yaade?.search
      if (!searchApi?.project) {
        showYaadeToast("Project search is unavailable", { variant: "destructive" })
        return
      }
      setSearchPending(true)
      try {
        const hits = await searchApi.project(rootUri, query)
        if (hits.length === 0) {
          showYaadeToast(`No matches for “${query}”`, { variant: "destructive" })
          return
        }
        const errorfile = await writeQuickfixTempFile(
          formatSearchHitsAsQuickfix(hits),
        )
        const created = await createProjectSession({
          rootPath: projectPath,
          title: `Search: ${query}`.slice(0, 80),
        })
        await saveProjectSessionPayload(
          created.id,
          buildNeovimQflistSessionPayload(created.cwdPath, errorfile),
        )
        await onOpenSession(created.id)
      } catch (err) {
        showYaadeToast(err instanceof Error ? err.message : String(err), {
          variant: "destructive",
        })
      } finally {
        setSearchPending(false)
      }
    },
    [onOpenSession, projectPath, rootUri],
  )

  return (
    <AppShell>
      <div
        className="flex h-full min-h-0 w-full flex-col bg-background"
        data-yaade-shell="project"
        data-yaade-project-path={projectPath}
      >
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <ProjectPathSwitcher
            projectPath={projectPath}
            homeDir={homeDir}
            onNavigate={onNavigateProject}
          />
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
            <main className="h-full min-h-0 overflow-auto p-4 md:p-6">
              <ProjectSearchBox
                pending={searchPending}
                onSubmit={handleProjectSearch}
              />
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
                      <li key={commit.hash}>
                        <button
                          type="button"
                          className="flex w-full items-start gap-3 px-3 py-2 text-left outline-none hover:bg-accent/30 focus-visible:bg-accent/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
                          data-yaade-recent-commit=""
                          data-yaade-commit-hash={commit.hash}
                          onClick={() => setViewingCommit(commit)}
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
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </main>
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

      {viewingCommit ? (
        <Suspense fallback={null}>
          <CommitChangesDialog
            open
            onOpenChange={open => {
              if (!open) setViewingCommit(null)
            }}
            rootUri={rootUri}
            hash={viewingCommit.hash}
            theme={activeTheme}
            fontSize={appearanceSettings.fontSize}
            commit={viewingCommit}
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
    </AppShell>
  )
}
