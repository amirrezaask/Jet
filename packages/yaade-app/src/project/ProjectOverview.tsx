import { lazy, Suspense, useEffect, useMemo, useState } from "react"
import type { GitCommit, YaadeTheme } from "@yaade/shared"
import { pathToFileUri } from "@yaade/shared"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@yaade/ui/primitives"
import { ChevronRight } from "lucide-react"

const CommitChangesDialog = lazy(() =>
  import("@yaade/ui/git").then(m => ({ default: m.CommitChangesDialog })),
)

const README_HEAD_LINES = 16
const RECENT_COMMIT_LIMIT = 12

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

export type ProjectOverviewProps = {
  projectPath: string
  homeDir: string
  theme: YaadeTheme
  fontSize?: number
}

async function readReadme(projectPath: string): Promise<string | null> {
  const fs = window.yaade?.fs
  if (!fs?.readFile) return null
  for (const name of ["README.md", "README", "Readme.md", "readme.md"]) {
    try {
      const text = await fs.readFile(
        pathToFileUri(`${projectPath.replace(/\/+$/, "")}/${name}`),
      )
      if (typeof text === "string" && text.length > 0) return text
    } catch {
      /* try next */
    }
  }
  return null
}

function splitReadmeHead(text: string): { head: string; hasMore: boolean } {
  const lines = text.split("\n")
  if (lines.length <= README_HEAD_LINES) {
    return { head: text, hasMore: false }
  }
  return {
    head: lines.slice(0, README_HEAD_LINES).join("\n").trimEnd(),
    hasMore: true,
  }
}

async function loadRecentCommits(projectPath: string): Promise<GitCommit[] | null> {
  const git = window.yaade?.git
  if (!git?.isRepo || !git.history) return null
  const rootUri = pathToFileUri(projectPath)
  try {
    if (!(await git.isRepo(rootUri))) return null
    return await git.history(rootUri, RECENT_COMMIT_LIMIT)
  } catch {
    return null
  }
}

export function ProjectOverview({
  projectPath,
  homeDir,
  theme,
  fontSize = 13,
}: ProjectOverviewProps) {
  const [readme, setReadme] = useState<string | null | undefined>(undefined)
  const [readmeOpen, setReadmeOpen] = useState(false)
  const [commits, setCommits] = useState<GitCommit[] | null | undefined>(
    undefined,
  )
  const [dialogCommit, setDialogCommit] = useState<GitCommit | null>(null)
  const rootUri = useMemo(() => pathToFileUri(projectPath), [projectPath])
  const projectName = useMemo(
    () => projectPath.split("/").filter(Boolean).pop() ?? projectPath,
    [projectPath],
  )
  const displayPath = useMemo(() => {
    if (homeDir && projectPath.startsWith(homeDir)) {
      const rest = projectPath.slice(homeDir.length)
      return `~${rest || ""}`
    }
    return projectPath
  }, [homeDir, projectPath])

  const readmeParts = useMemo(
    () => (typeof readme === "string" ? splitReadmeHead(readme) : null),
    [readme],
  )

  useEffect(() => {
    let cancelled = false
    setReadme(undefined)
    setReadmeOpen(false)
    setCommits(undefined)
    setDialogCommit(null)
    void readReadme(projectPath).then(text => {
      if (!cancelled) setReadme(text)
    })
    void loadRecentCommits(projectPath).then(list => {
      if (!cancelled) setCommits(list)
    })
    return () => {
      cancelled = true
    }
  }, [projectPath])

  return (
    <main
      className="h-full min-h-0 overflow-auto p-4 md:p-6"
      data-yaade-project-overview=""
    >
      <header className="mb-6">
        <h1
          className="text-xl font-semibold tracking-tight text-foreground"
          data-yaade-project-name=""
        >
          {projectName}
        </h1>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          {displayPath}
        </p>
      </header>

      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <section aria-labelledby="yaade-overview-commits-heading">
          <h2
            id="yaade-overview-commits-heading"
            className="mb-3 text-sm font-medium text-foreground"
          >
            Recent commits
          </h2>
          {commits === undefined ? (
            <p className="text-sm text-muted-foreground" role="status">
              Loading…
            </p>
          ) : commits === null ? (
            <p
              className="text-sm text-muted-foreground"
              data-yaade-project-commits-empty=""
            >
              Not a git repository.
            </p>
          ) : commits.length === 0 ? (
            <p
              className="text-sm text-muted-foreground"
              data-yaade-project-commits-empty=""
            >
              No commits yet.
            </p>
          ) : (
            <ul
              className="divide-y divide-border/60 border-y border-border/60"
              data-yaade-project-commits=""
              data-yaade-list-panel="project-commits"
            >
              {commits.map(commit => (
                <li key={commit.hash} className="shrink-0">
                  <button
                    type="button"
                    data-yaade-list-item=""
                    data-yaade-project-commit={commit.shortHash}
                    onClick={() => setDialogCommit(commit)}
                    className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-2.5 text-left outline-none transition-colors hover:bg-accent/25 focus-visible:bg-accent/25 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 active:scale-[0.99]"
                  >
                    <span className="font-mono text-3xs text-primary/90">
                      {commit.shortHash}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-xs text-foreground">
                        {commit.subject}
                      </p>
                      <p className="mt-0.5 truncate text-3xs text-muted-foreground">
                        {commit.author}
                      </p>
                    </div>
                    <time
                      className="shrink-0 text-right font-mono text-3xs tabular-nums text-muted-foreground"
                      dateTime={new Date(commit.authoredAt).toISOString()}
                    >
                      {dateFormatter.format(new Date(commit.authoredAt))}
                    </time>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="yaade-overview-readme-heading">
          <h2
            id="yaade-overview-readme-heading"
            className="mb-3 text-sm font-medium text-foreground"
          >
            README
          </h2>
          {readme === undefined ? (
            <p className="text-sm text-muted-foreground" role="status">
              Loading…
            </p>
          ) : readme === null || !readmeParts ? (
            <Empty className="border border-dashed border-border">
              <EmptyHeader>
                <EmptyTitle>No README</EmptyTitle>
                <EmptyDescription>
                  Add a README.md in this project, or open a worktree to start a
                  tiling workspace.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div data-yaade-project-readme="">
              <pre
                className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground/90"
                data-yaade-project-readme-head=""
              >
                {readmeParts.head}
              </pre>
              {readmeParts.hasMore ? (
                <Collapsible
                  open={readmeOpen}
                  onOpenChange={setReadmeOpen}
                  className="group/readme mt-3"
                  data-yaade-project-readme-accordion=""
                >
                  <CollapsibleTrigger
                    className="flex w-full items-center gap-1.5 rounded-md px-1 py-1.5 text-left text-xs text-muted-foreground outline-none transition-colors hover:bg-accent/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
                    data-yaade-project-readme-expand=""
                  >
                    <ChevronRight
                      className="size-3.5 shrink-0 transition-transform duration-[var(--yaade-motion-fast)] group-data-[state=open]/readme:rotate-90"
                      aria-hidden
                    />
                    {readmeOpen ? "Hide full README" : "Show full README"}
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <pre
                      className="mt-2 overflow-x-auto whitespace-pre-wrap break-words border-t border-border/60 pt-3 font-mono text-xs leading-relaxed text-foreground/90"
                      data-yaade-project-readme-full=""
                    >
                      {readme}
                    </pre>
                  </CollapsibleContent>
                </Collapsible>
              ) : null}
            </div>
          )}
        </section>
      </div>

      {dialogCommit ? (
        <Suspense fallback={null}>
          <CommitChangesDialog
            open
            onOpenChange={open => {
              if (!open) setDialogCommit(null)
            }}
            rootUri={rootUri}
            hash={dialogCommit.hash}
            theme={theme}
            fontSize={fontSize}
            commit={dialogCommit}
          />
        </Suspense>
      ) : null}
    </main>
  )
}
