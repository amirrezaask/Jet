import { lazy, Suspense, useEffect, useMemo, useState } from "react"
import type { ProjectSessionSummary } from "@yaade/rpc"
import type { GitRepositorySummary, GitWorktree } from "@yaade/shared"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
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
} from "@yaade/ui/primitives"
import {
  AlertCircle,
  Bot,
  ChevronDown,
  Clock3,
  FileCode2,
  FileText,
  FolderGit2,
  GitBranch,
  Play,
  Plus,
  RefreshCw,
  Terminal,
} from "lucide-react"
import type { MuxLaunchAction } from "../mux/MuxApp.js"
import { CreateWorktreeDialog } from "./CreateWorktreeDialog.js"
import {
  loadProjectDashboard,
  recentProjectSessions,
  resolveProjectFilePath,
  visibleLinkedWorktrees,
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
  homeDir: string
  active: boolean
  listSessions: () => Promise<ProjectSessionSummary[]>
  onLaunchAgent: () => void
  onLaunchAction: (action: MuxLaunchAction) => void | Promise<void>
  onResumeWorkspace: () => void | Promise<void>
  onResumeSession: (sessionId: string) => void | Promise<void>
  onOpenCheckout: (input: {
    cwdPath: string
    title?: string
    worktreeBranch?: string | null
    worktreePath?: string | null
  }) => Promise<void>
  onCreateWorktree: (input: {
    branch: string
    baseRef?: string
  }) => Promise<void>
  onRepositorySummary?: (summary: GitRepositorySummary | null) => void
}

function projectName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path
}

function branchLabel(worktree: GitWorktree): string {
  if (worktree.branch) return worktree.branch.replace(/^refs\/heads\//, "")
  if (worktree.detached && worktree.head) {
    return `detached@${worktree.head.slice(0, 7)}`
  }
  return projectName(worktree.path)
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
      className="grid min-w-0 gap-8 lg:grid-cols-[minmax(18rem,0.7fr)_minmax(0,1.3fr)]"
      role="status"
      aria-label="Loading project overview"
    >
      {[0, 1].map(index => (
        <section key={index} className="min-w-0 space-y-3 py-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
          <div className="grid gap-2 pt-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-4/5" />
          </div>
        </section>
      ))}
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
  homeDir,
  active,
  listSessions,
  onLaunchAgent,
  onLaunchAction,
  onResumeWorkspace,
  onResumeSession,
  onOpenCheckout,
  onCreateWorktree,
  onRepositorySummary,
}: ProjectOverviewProps) {
  const [dashboard, setDashboard] = useState<ProjectDashboard | null>(null)
  const [refreshRevision, setRefreshRevision] = useState(0)
  const [readmeOpen, setReadmeOpen] = useState(false)
  const [createWorktreeOpen, setCreateWorktreeOpen] = useState(false)

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
      onRepositorySummary?.(result.summary.value)
    })
    return () => {
      cancelled = true
    }
  }, [active, listSessions, onRepositorySummary, projectPath, refreshRevision])

  const sessions = useMemo(
    () => recentProjectSessions(dashboard?.sessions.value ?? []),
    [dashboard?.sessions.value],
  )
  const linkedWorktrees = useMemo(
    () => visibleLinkedWorktrees(dashboard?.worktrees.value ?? [], projectPath),
    [dashboard?.worktrees.value, projectPath],
  )
  const readmeParts = useMemo(
    () => (dashboard?.readme.value ? splitReadme(dashboard.readme.value) : null),
    [dashboard?.readme.value],
  )
  const defaultBranch =
    dashboard?.defaultBranch.value ?? dashboard?.summary.value?.branch ?? "main"

  const openFile = (target: string) => {
    const filePath = resolveProjectFilePath(projectPath, target)
    if (filePath) void onLaunchAction({ kind: "editor", filePath })
  }

  return (
    <main
      className="h-full min-h-0 overflow-auto overflow-x-hidden px-3 py-5 sm:px-6 lg:px-8"
      data-yaade-project-overview=""
    >
      <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-8">
        <section className="flex min-w-0 flex-col gap-5">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
                  {projectName(projectPath)}
                </h1>
                {dashboard?.isGitRepo.value && dashboard.summary.value?.branch ? (
                  <Badge variant="secondary">
                    <GitBranch aria-hidden />
                    {dashboard.summary.value.branch}
                  </Badge>
                ) : null}
                {dashboard?.summary.value?.upstream ? (
                  <Badge variant="outline">{dashboard.summary.value.upstream}</Badge>
                ) : null}
                {dashboard?.summary.value?.ahead ? (
                  <Badge variant="info">↑ {dashboard.summary.value.ahead}</Badge>
                ) : null}
                {dashboard?.summary.value?.behind ? (
                  <Badge variant="warning">↓ {dashboard.summary.value.behind}</Badge>
                ) : null}
                {dashboard?.status.value?.length ? (
                  <Badge variant="warning">{dashboard.status.value.length} changed</Badge>
                ) : dashboard?.isGitRepo.value ? (
                  <Badge variant="success">Clean</Badge>
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

          <div
            className="flex flex-wrap items-center gap-1.5"
            data-yaade-command-deck=""
          >
            <Button
              className="w-full justify-center sm:w-auto"
              onClick={onLaunchAgent}
              data-yaade-launch-agent=""
            >
              <Bot aria-hidden />
              Launch agent
            </Button>
            <Button variant="ghost" onClick={() => void onLaunchAction({ kind: "terminal" })} data-yaade-launch-tool="terminal">
              <Terminal aria-hidden />
              Terminal
            </Button>
            <Button variant="ghost" onClick={() => void onLaunchAction({ kind: "editor" })} data-yaade-launch-tool="editor">
              <FileCode2 aria-hidden />
              Editor
            </Button>
            <Button variant="ghost" onClick={() => void onLaunchAction({ kind: "neovim" })} data-yaade-launch-tool="neovim">
              <Terminal aria-hidden />
              Neovim
            </Button>
            <Button variant="ghost" onClick={() => void onLaunchAction({ kind: "git" })} data-yaade-launch-tool="git">
              <GitBranch aria-hidden />
              Git
            </Button>
            <Button variant="ghost" onClick={() => void onResumeWorkspace()} data-yaade-resume-workspace="">
              <Play aria-hidden />
              Resume
            </Button>
          </div>

          <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Worktrees</h2>
                <p className="text-xs text-muted-foreground">Choose the checkout to open.</p>
              </div>
              {dashboard?.isGitRepo.value ? (
                <Button variant="ghost" size="sm" onClick={() => setCreateWorktreeOpen(true)} data-yaade-project-create-worktree="">
                  <Plus aria-hidden />
                  Create
                </Button>
              ) : null}
            </div>
            {!dashboard ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : dashboard.isGitRepo.error || dashboard.worktrees.error ? (
              <ErrorNotice
                title="Worktrees unavailable"
                message={dashboard.worktrees.error ?? dashboard.isGitRepo.error!}
              />
            ) : (
              <ItemGroup
                className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3"
                data-yaade-list-panel="project-worktrees"
                data-yaade-project-worktrees=""
              >
                <Item size="sm" className="min-w-0 flex-nowrap hover:bg-muted/40" data-yaade-list-item="" data-yaade-project-worktree="main">
                  <FolderGit2 className="size-4 text-muted-foreground" aria-hidden />
                  <ItemContent>
                    <ItemTitle><span>Main</span></ItemTitle>
                    <ItemDescription className="truncate font-mono text-xs"><span>{projectPath}</span></ItemDescription>
                  </ItemContent>
                  <Button variant="ghost" size="sm" onClick={() => void onOpenCheckout({ cwdPath: projectPath, title: "Main" })}>Open</Button>
                </Item>
                {linkedWorktrees.map(worktree => (
                  <Item key={worktree.path} size="sm" className="min-w-0 flex-nowrap hover:bg-muted/40" data-yaade-list-item="" data-yaade-project-worktree={worktree.path}>
                    <GitBranch className="size-4 text-muted-foreground" aria-hidden />
                    <ItemContent>
                      <ItemTitle><span>{branchLabel(worktree)}</span></ItemTitle>
                      <ItemDescription className="truncate font-mono text-xs"><span>{worktree.path}</span></ItemDescription>
                    </ItemContent>
                    <Button variant="ghost" size="sm" onClick={() => void onOpenCheckout({
                      cwdPath: worktree.path,
                      title: branchLabel(worktree),
                      worktreeBranch: worktree.branch?.replace(/^refs\/heads\//, "") ?? null,
                      worktreePath: worktree.path,
                    })}>Open</Button>
                  </Item>
                ))}
              </ItemGroup>
            )}
          </div>
        </section>

        {!dashboard ? (
          <DashboardSkeleton />
        ) : (
          <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(18rem,0.7fr)_minmax(0,1.3fr)] lg:gap-12">
            <section className="min-w-0 py-2" aria-labelledby="recent-sessions-heading">
              <h2 id="recent-sessions-heading" className="text-base font-semibold">Recent sessions</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Your five most recently active workspaces.</p>
              <div className="mt-3">
                {dashboard.sessions.error ? (
                  <ErrorNotice title="Sessions unavailable" message={dashboard.sessions.error} />
                ) : sessions.length === 0 ? (
                  <Empty className="min-h-32 bg-muted/20">
                    <EmptyHeader>
                      <EmptyMedia variant="icon"><Clock3 aria-hidden /></EmptyMedia>
                      <EmptyTitle>No sessions yet</EmptyTitle>
                      <EmptyDescription>Launch a tool to create the Main workspace.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  <ItemGroup className="gap-1" data-yaade-list-panel="project-sessions" data-yaade-project-sessions="">
                    {sessions.map(item => (
                      <Item key={item.id} size="sm" className="flex-nowrap hover:bg-muted/40" data-yaade-list-item="" data-yaade-project-session={item.id}>
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

            <section className="min-w-0 py-2" data-yaade-project-readme="" aria-labelledby="project-readme-heading">
              <h2 id="project-readme-heading" className="text-base font-semibold">README</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Project context without leaving the cockpit.</p>
              <div className="mt-3">
                {dashboard.readme.error ? (
                  <ErrorNotice title="README unavailable" message={dashboard.readme.error} />
                ) : !dashboard.readme.value || !readmeParts ? (
                  <Empty className="min-h-32 bg-muted/20">
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
                      className="min-w-0 overflow-hidden"
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

      <CreateWorktreeDialog
        open={createWorktreeOpen}
        onOpenChange={setCreateWorktreeOpen}
        projectPath={projectPath}
        homeDir={homeDir}
        defaultBranch={defaultBranch}
        onCreate={async input => {
          await onCreateWorktree(input)
          setCreateWorktreeOpen(false)
        }}
      />
    </main>
  )
}
