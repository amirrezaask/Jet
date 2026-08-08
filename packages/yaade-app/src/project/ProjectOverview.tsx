import { lazy, Suspense, useEffect, useMemo, useState } from "react"
import type { ProjectSessionSummary } from "@yaade/rpc"
import { pathToFileUri, type GitCommit } from "@yaade/shared"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Skeleton,
  Spinner,
} from "@yaade/ui/primitives"
import { showYaadeToast } from "@yaade/ui/toast"
import {
  AlertCircle,
  ArrowRight,
  ChevronDown,
  Clock3,
  FileText,
  GitBranch,
  GitCommitHorizontal,
  RefreshCw,
} from "lucide-react"
import type { MuxLaunchAction } from "../mux/MuxApp.js"
import {
  loadProjectDashboard,
  recentProjectSessions,
  resolveProjectFilePath,
  type ProjectDashboard,
} from "./project-dashboard.js"

const ProjectReadme = lazy(() =>
  import("@yaade/ui/markdown").then(module => ({
    default: module.ProjectReadme,
  })),
)

const README_HEAD_LINES = 16

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

export type ProjectOverviewProps = {
  projectPath: string
  active: boolean
  listSessions: () => Promise<ProjectSessionSummary[]>
  onLaunchAction: (action: MuxLaunchAction) => void | Promise<void>
  onResumeSession: (sessionId: string) => void | Promise<void>
  onOpenCommit: (commit: GitCommit) => void
  onShowHistory: () => void
}

function projectName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path
}

function checkoutLabel(session: ProjectSessionSummary): string {
  if (session.worktreeBranch) return session.worktreeBranch
  return session.cwdPath === session.projectPath
    ? "Main"
    : projectName(session.cwdPath)
}

function ErrorNotice({ title, message }: { title: string; message: string }) {
  return (
    <Alert variant="destructive">
      <AlertCircle aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

function DashboardSkeleton() {
  return (
    <div
      className="flex min-w-0 flex-col gap-3"
      role="status"
      aria-label="Loading project overview"
    >
      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(18rem,0.7fr)_minmax(0,1.3fr)]">
        {[0, 1].map(index => (
          <section key={index} className="flex min-w-0 flex-col gap-3 p-4" data-yaade-island="">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
            <div className="grid gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-4/5" />
            </div>
          </section>
        ))}
      </div>
      <section className="flex min-w-0 flex-col gap-3 p-4" data-yaade-island="">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-48" />
        <div className="grid gap-2">
          <Skeleton className="h-48 w-full" />
        </div>
      </section>
    </div>
  )
}

function splitReadme(text: string): { head: string; hasMore: boolean } {
  const lines = text.split("\n")
  return lines.length > README_HEAD_LINES
    ? {
        head: lines.slice(0, README_HEAD_LINES).join("\n").trimEnd(),
        hasMore: true,
      }
    : { head: text, hasMore: false }
}

export function ProjectOverview({
  projectPath,
  active,
  listSessions,
  onLaunchAction,
  onResumeSession,
  onOpenCommit,
  onShowHistory,
}: ProjectOverviewProps) {
  const [dashboard, setDashboard] = useState<ProjectDashboard | null>(null)
  const [refreshRevision, setRefreshRevision] = useState(0)
  const [readmeOpen, setReadmeOpen] = useState(false)
  const [switchingBranch, setSwitchingBranch] = useState<string | null>(null)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    setDashboard(null)
    setReadmeOpen(false)
    void loadProjectDashboard(projectPath, {
      fs: window.yaade?.fs,
      git: window.yaade?.git,
      listSessions,
    }).then(result => {
      if (cancelled) return
      setDashboard(result)
    })
    return () => {
      cancelled = true
    }
  }, [active, listSessions, projectPath, refreshRevision])

  const sessions = useMemo(
    () => recentProjectSessions(dashboard?.sessions.value ?? []),
    [dashboard?.sessions.value],
  )
  const readmeParts = useMemo(
    () => (dashboard?.readme.value ? splitReadme(dashboard.readme.value) : null),
    [dashboard?.readme.value],
  )
  const currentBranch = dashboard?.branch.value ?? null
  const branchOptions = useMemo(() => {
    const branches = dashboard?.branches.value ?? []
    if (!currentBranch) return branches
    return [currentBranch, ...branches.filter(branch => branch !== currentBranch)]
  }, [currentBranch, dashboard?.branches.value])

  const openFile = (target: string) => {
    const filePath = resolveProjectFilePath(projectPath, target)
    if (filePath) void onLaunchAction({ kind: "editor", filePath })
  }

  const switchBranch = async (branch: string) => {
    const git = window.yaade?.git
    if (!git || branch === currentBranch || switchingBranch) return
    setSwitchingBranch(branch)
    try {
      await git.checkout(pathToFileUri(projectPath), branch)
      showYaadeToast(`Switched to ${branch}`, { variant: "success" })
      setRefreshRevision(value => value + 1)
    } catch (error) {
      showYaadeToast("Could not switch branch", {
        description:
          error instanceof Error ? error.message : "Git checkout failed.",
        variant: "destructive",
      })
    } finally {
      setSwitchingBranch(null)
    }
  }

  return (
    <main
      className="h-full min-h-0 overflow-auto overflow-x-hidden px-3 py-3 sm:px-5 sm:py-4 lg:px-6"
      data-yaade-project-overview=""
    >
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-3">
        <section className="flex min-w-0 flex-col gap-4 p-3 sm:p-4" data-yaade-island="" data-yaade-project-hero="">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
                  {projectName(projectPath)}
                </h1>
                {dashboard?.isGitRepo.value ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 max-w-full gap-1.5 px-2 text-xs font-normal"
                        aria-label={`Switch branch. Current branch: ${currentBranch ?? "unknown"}`}
                        aria-busy={switchingBranch != null}
                        disabled={switchingBranch != null}
                        data-yaade-project-branch-menu=""
                      >
                        {switchingBranch ? <Spinner aria-hidden /> : <GitBranch aria-hidden />}
                        <span className="truncate font-mono">
                          {switchingBranch ?? currentBranch ?? "Choose branch"}
                        </span>
                        <ChevronDown className="size-3" aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      className="w-64 max-w-[calc(100vw-2rem)]"
                      aria-label="Switch branch"
                      data-yaade-list-panel="project-branches"
                    >
                      <DropdownMenuLabel className="text-xs text-muted-foreground">
                        Switch branch
                      </DropdownMenuLabel>
                      {dashboard.branches.error ? (
                        <DropdownMenuItem disabled className="shrink-0" data-yaade-list-item="">
                          Branches unavailable
                        </DropdownMenuItem>
                      ) : branchOptions.length === 0 ? (
                        <DropdownMenuItem disabled className="shrink-0" data-yaade-list-item="">
                          No branches
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuRadioGroup
                          value={currentBranch ?? ""}
                          onValueChange={branch => void switchBranch(branch)}
                        >
                          {branchOptions.map(branch => (
                            <DropdownMenuRadioItem
                              key={branch}
                              value={branch}
                              className="min-w-0 shrink-0 font-mono text-xs"
                              data-yaade-list-item=""
                              data-yaade-project-branch={branch}
                            >
                              <span className="truncate">{branch}</span>
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
              <p
                className="mt-1 truncate font-mono text-xs text-muted-foreground"
                title={projectPath}
              >
                {projectPath}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRefreshRevision(value => value + 1)}
              aria-label="Refresh project overview"
              data-yaade-project-refresh=""
            >
              <RefreshCw aria-hidden />
              Refresh
            </Button>
          </div>
        </section>

        {!dashboard ? (
          <DashboardSkeleton />
        ) : (
          <div className="flex min-w-0 flex-col gap-3">
            <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(18rem,0.7fr)_minmax(0,1.3fr)]">
              <section className="min-w-0 p-3 sm:p-4" aria-labelledby="recent-sessions-heading" data-yaade-island="">
                <h2 id="recent-sessions-heading" className="text-base font-semibold">Recent sessions</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">Your five most recently active workspaces.</p>
                <div className="mt-3">
                  {dashboard.sessions.error ? (
                    <ErrorNotice title="Sessions unavailable" message={dashboard.sessions.error} />
                  ) : sessions.length === 0 ? (
                    <Empty className="min-h-32 border-0 bg-secondary/50">
                      <EmptyHeader>
                        <EmptyMedia variant="icon"><Clock3 aria-hidden /></EmptyMedia>
                        <EmptyTitle>No sessions yet</EmptyTitle>
                        <EmptyDescription>Sessions you open will appear here.</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : (
                    <ItemGroup className="gap-0.5" data-yaade-list-panel="project-sessions" data-yaade-project-sessions="">
                      {sessions.map(item => (
                        <Item key={item.id} size="sm" className="flex-nowrap hover:bg-accent" data-yaade-list-item="" data-yaade-project-session={item.id}>
                          <ItemContent>
                            <ItemTitle>{item.title}</ItemTitle>
                            <ItemDescription className="flex flex-wrap items-center gap-x-2 font-mono text-xs">
                              <span>{checkoutLabel(item)}</span>
                              <time dateTime={item.updatedAt}>{dateFormatter.format(new Date(item.updatedAt))}</time>
                            </ItemDescription>
                          </ItemContent>
                          <Button variant="ghost" size="sm" onClick={() => void onResumeSession(item.id)}>Resume</Button>
                        </Item>
                      ))}
                    </ItemGroup>
                  )}
                </div>
              </section>

              <section className="min-w-0 p-3 sm:p-4" data-yaade-project-commits="" data-yaade-island="" aria-labelledby="project-commits-heading">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 id="project-commits-heading" className="text-base font-semibold">Recent commits</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">The latest changes on the current branch.</p>
                  </div>
                  {dashboard.isGitRepo.value ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
                      onClick={onShowHistory}
                      data-yaade-project-history-more=""
                    >
                      Show more
                      <ArrowRight data-icon="inline-end" aria-hidden />
                    </Button>
                  ) : null}
                </div>
                <div className="mt-3">
                  {dashboard.history.error ? (
                    <ErrorNotice title="Commits unavailable" message={dashboard.history.error} />
                  ) : !dashboard.isGitRepo.value ? (
                    <Empty className="min-h-32 border-0 bg-secondary/50">
                      <EmptyHeader>
                        <EmptyMedia variant="icon"><GitCommitHorizontal aria-hidden /></EmptyMedia>
                        <EmptyTitle>No Git history</EmptyTitle>
                        <EmptyDescription>Initialize a Git repository to track project changes.</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : !dashboard.history.value?.length ? (
                    <Empty className="min-h-32 border-0 bg-secondary/50">
                      <EmptyHeader>
                        <EmptyMedia variant="icon"><GitCommitHorizontal aria-hidden /></EmptyMedia>
                        <EmptyTitle>No commits yet</EmptyTitle>
                        <EmptyDescription>Create the first commit to start project history.</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : (
                    <ItemGroup className="gap-0.5" data-yaade-list-panel="project-commits">
                      {dashboard.history.value.map(commit => (
                        <Item
                          key={commit.hash}
                          asChild
                          size="sm"
                          className="flex-nowrap text-left hover:bg-accent"
                          data-yaade-list-item=""
                          data-yaade-project-commit={commit.hash}
                        >
                          <button type="button" onClick={() => onOpenCommit(commit)}>
                            <GitCommitHorizontal className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                            <ItemContent>
                              <ItemTitle>{commit.subject}</ItemTitle>
                              <ItemDescription className="flex flex-wrap items-center gap-x-2 text-xs">
                                <span>{commit.author}</span>
                                <time dateTime={new Date(commit.authoredAt).toISOString()}>
                                  {dateFormatter.format(new Date(commit.authoredAt))}
                                </time>
                              </ItemDescription>
                            </ItemContent>
                            <Badge variant="outline">
                              <span className="font-mono">{commit.shortHash}</span>
                            </Badge>
                          </button>
                        </Item>
                      ))}
                    </ItemGroup>
                  )}
                </div>
              </section>
            </div>

            <section className="min-w-0 p-3 sm:p-4" data-yaade-project-readme="" data-yaade-island="" aria-labelledby="project-readme-heading">
              <h2 id="project-readme-heading" className="text-base font-semibold">README</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Project context without leaving the cockpit.</p>
              <div className="mt-3">
                {dashboard.readme.error ? (
                  <ErrorNotice title="README unavailable" message={dashboard.readme.error} />
                ) : !dashboard.readme.value || !readmeParts ? (
                  <Empty className="min-h-32 border-0 bg-secondary/50">
                    <EmptyHeader>
                      <EmptyMedia variant="icon"><FileText aria-hidden /></EmptyMedia>
                      <EmptyTitle>No README</EmptyTitle>
                      <EmptyDescription>Add README.md to give this project a useful landing page.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  <>
                    <div
                      data-yaade-project-readme-head={readmeOpen ? undefined : ""}
                      data-yaade-project-readme-full={readmeOpen ? "" : undefined}
                      className="min-w-0 overflow-hidden rounded-md border border-border bg-secondary/25 p-3"
                    >
                      <Suspense fallback={<Skeleton className="h-48 w-full" />}>
                        <ProjectReadme
                          content={readmeOpen ? dashboard.readme.value : readmeParts.head}
                          onOpenProjectFile={openFile}
                        />
                      </Suspense>
                    </div>
                    {readmeParts.hasMore ? (
                      <Button
                        className="mt-3"
                        variant="ghost"
                        size="sm"
                        onClick={() => setReadmeOpen(value => !value)}
                        data-yaade-project-readme-expand=""
                      >
                        <ChevronDown className={readmeOpen ? "rotate-180" : ""} aria-hidden />
                        {readmeOpen ? "Collapse README" : "Expand README"}
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  )
}
