import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { PatchDiff } from "@pierre/diffs/react"
import { useVirtualizer } from "@tanstack/react-virtual"
import type { GitCommit, GitRepositorySummary, GitStatusEntry } from "@gharargah/shared"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleDotIcon,
  CopyIcon,
  ExternalLinkIcon,
  FileDiffIcon,
  GitBranchIcon,
  HistoryIcon,
  MoreHorizontalIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  UploadIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button.js"
import { Checkbox } from "@/components/ui/checkbox.js"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty.js"
import { Input } from "@/components/ui/input.js"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable.js"
import { Spinner } from "@/components/ui/spinner.js"
import { cn } from "@/lib/utils.js"
import { requestConfirm } from "@/components/ConfirmDialogHost.js"
import { showGharargahToast } from "@/toast.js"

type GitWorkspaceProps = {
  rootUri: string | null
  repositoryName: string
  onOpenFile: (path: string) => void
  onBranchChange?: (branch: string | null) => void
}

type GitView = "changes" | "staged" | "history"
type DiffStyle = "unified" | "split"
type SelectedChange = { path: string; staged: boolean }
type NavigationRow =
  | { kind: "section"; id: string; label: string; count: number }
  | { kind: "file"; id: string; entry: GitStatusEntry; staged: boolean }

const EMPTY_SUMMARY: GitRepositorySummary = {
  branch: null,
  upstream: null,
  ahead: 0,
  behind: 0,
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

export function GitWorkspace(props: GitWorkspaceProps) {
  const { rootUri, repositoryName, onOpenFile, onBranchChange } = props
  const api = window.gharargah?.git
  const [isRepo, setIsRepo] = useState<boolean | null>(null)
  const [entries, setEntries] = useState<GitStatusEntry[]>([])
  const [summary, setSummary] = useState<GitRepositorySummary>(EMPTY_SUMMARY)
  const [branches, setBranches] = useState<string[]>([])
  const [history, setHistory] = useState<GitCommit[]>([])
  const [view, setView] = useState<GitView>("changes")
  const [selected, setSelected] = useState<SelectedChange | null>(null)
  const [filter, setFilter] = useState("")
  const [patch, setPatch] = useState("")
  const [diffStyle, setDiffStyle] = useState<DiffStyle>(() =>
    localStorage.getItem("gharargah:git-diff-style") === "split" ? "split" : "unified",
  )
  const [loading, setLoading] = useState(true)
  const [diffLoading, setDiffLoading] = useState(false)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [commitSummary, setCommitSummary] = useState("")
  const [commitBody, setCommitBody] = useState("")
  const diffRequest = useRef(0)

  const refresh = useCallback(async () => {
    if (!rootUri || !api) {
      setIsRepo(false)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const repository = await api.isRepo(rootUri)
      setIsRepo(repository)
      if (!repository) return
      const [nextEntries, nextSummary, nextBranches, nextHistory] = await Promise.all([
        api.status(rootUri),
        api.summary(rootUri),
        api.branches(rootUri),
        api.history(rootUri, 60).catch(() => []),
      ])
      setEntries(nextEntries)
      setSummary(nextSummary)
      setBranches(nextBranches)
      setHistory(nextHistory)
      onBranchChange?.(nextSummary.branch)
      setSelected(current => {
        if (current) {
          const sameFile = nextEntries.find(entry => entry.path === current.path)
          if (sameFile) {
            if (current.staged && sameFile.staged) return current
            if (!current.staged && sameFile.unstaged) return current
            if (sameFile.unstaged) return { path: sameFile.path, staged: false }
            if (sameFile.staged) return { path: sameFile.path, staged: true }
          }
        }
        const first = nextEntries.find(entry => entry.unstaged) ?? nextEntries.find(entry => entry.staged)
        return first ? { path: first.path, staged: !first.unstaged && first.staged } : null
      })
    } catch (error) {
      showGharargahToast("Could not refresh Git", {
        variant: "destructive",
        description: errorMessage(error),
      })
    } finally {
      setLoading(false)
    }
  }, [api, onBranchChange, rootUri])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!rootUri || !api || !selected) {
      setPatch("")
      return
    }
    const request = ++diffRequest.current
    setDiffLoading(true)
    void api
      .diff(rootUri, { path: selected.path, staged: selected.staged })
      .then(nextPatch => {
        if (request === diffRequest.current) setPatch(nextPatch)
      })
      .catch(error => {
        if (request !== diffRequest.current) return
        setPatch("")
        showGharargahToast("Could not load diff", {
          variant: "destructive",
          description: errorMessage(error),
        })
      })
      .finally(() => {
        if (request === diffRequest.current) setDiffLoading(false)
      })
  }, [api, rootUri, selected])

  const filteredEntries = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase()
    if (!needle) return entries
    return entries.filter(entry => entry.path.toLocaleLowerCase().includes(needle))
  }, [entries, filter])

  const navigationRows = useMemo(
    () => buildNavigationRows(filteredEntries, view),
    [filteredEntries, view],
  )
  const stagedCount = entries.filter(entry => entry.staged).length
  const unstagedPaths = entries.filter(entry => entry.unstaged).map(entry => entry.path)
  const selectedEntry = selected ? entries.find(entry => entry.path === selected.path) : undefined

  useEffect(() => {
    if (view === "history") return
    const files = navigationRows.filter((row): row is Extract<NavigationRow, { kind: "file" }> => row.kind === "file")
    if (selected && files.some(row => row.entry.path === selected.path && row.staged === selected.staged)) return
    const first = files[0]
    setSelected(first ? { path: first.entry.path, staged: first.staged } : null)
  }, [navigationRows, selected, view])

  const runAction = useCallback(
    async (label: string, task: () => Promise<void>, success?: string): Promise<boolean> => {
      setPendingAction(label)
      try {
        await task()
        if (success) showGharargahToast(success, { variant: "success" })
        await refresh()
        return true
      } catch (error) {
        showGharargahToast(`${label} failed`, {
          variant: "destructive",
          description: errorMessage(error),
        })
        return false
      } finally {
        setPendingAction(null)
      }
    },
    [refresh],
  )

  const setAndPersistDiffStyle = (next: DiffStyle) => {
    setDiffStyle(next)
    localStorage.setItem("gharargah:git-diff-style", next)
  }

  const stageSelection = (change: SelectedChange) => {
    if (!rootUri || !api) return
    const task = change.staged
      ? () => api.unstage(rootUri, [change.path])
      : () => api.stage(rootUri, [change.path])
    void runAction(change.staged ? "Unstage" : "Stage", task)
  }

  const stageAll = () => {
    if (!rootUri || !api || unstagedPaths.length === 0) return
    void runAction("Stage all", () => api.stage(rootUri, unstagedPaths))
  }

  const discardSelection = async (entry: GitStatusEntry) => {
    if (!rootUri || !api || entry.status === "untracked") return
    const accepted = await requestConfirm({
      title: "Discard changes?",
      description: `Restore ${entry.path} to its last committed state. This cannot be undone.`,
      confirmLabel: "Discard changes",
      variant: "destructive",
    })
    if (!accepted) return
    await runAction("Discard", () => api.discard(rootUri, [entry.path]), "Changes discarded")
  }

  const commit = async () => {
    const message = commitSummary.trim()
    if (!rootUri || !api || !message || stagedCount === 0) return
    const committed = await runAction(
      "Commit",
      () => api.commit(rootUri, message, commitBody.trim() || undefined),
      `Committed ${stagedCount} ${stagedCount === 1 ? "file" : "files"}`,
    )
    if (!committed) return
    setCommitSummary("")
    setCommitBody("")
  }

  if (loading && isRepo === null) {
    return <CenteredStatus label="Loading repository…" />
  }

  if (!rootUri || !api || isRepo === false) {
    return (
      <Empty className="h-full rounded-none border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon"><GitBranchIcon aria-hidden /></EmptyMedia>
          <EmptyTitle className="text-base">No Git repository</EmptyTitle>
          <EmptyDescription>
            Open a session inside a Git repository to review changes, stage files, and commit.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <section
      data-gharargah-git-workspace=""
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background/55"
      aria-label="Git workspace"
    >
      <GitToolbar
        repositoryName={repositoryName}
        summary={summary}
        branches={branches}
        pendingAction={pendingAction}
        onCheckout={branch => {
          if (!rootUri || !api || branch === summary.branch) return
          void runAction("Switch branch", () => api.checkout(rootUri, branch), `Switched to ${branch}`)
        }}
        onRemoteAction={action => {
          if (!rootUri || !api) return
          const task = action === "fetch" ? api.fetch : action === "pull" ? api.pull : api.push
          void runAction(capitalize(action), () => task.call(api, rootUri), `${capitalize(action)} complete`)
        }}
        onRefresh={() => void refresh()}
      />

      <GitViewTabs
        view={view}
        stagedCount={stagedCount}
        historyCount={history.length}
        onChange={setView}
      />

      {view === "history" ? (
        <HistoryList commits={history} />
      ) : (
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1 bg-transparent">
          <ResizablePanel defaultSize="31%" minSize="220px" maxSize="48%">
            <FileNavigator
              rows={navigationRows}
              filter={filter}
              selected={selected}
              pending={pendingAction !== null}
              stageAllCount={view === "changes" ? unstagedPaths.length : 0}
              onFilterChange={setFilter}
              onSelect={setSelected}
              onToggleStage={stageSelection}
              onStageAll={stageAll}
              onOpenFile={onOpenFile}
              onDiscard={entry => void discardSelection(entry)}
            />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="69%" minSize="360px">
            <DiffViewer
              selected={selected}
              selectedEntry={selectedEntry}
              patch={patch}
              loading={diffLoading}
              diffStyle={diffStyle}
              pending={pendingAction !== null}
              onDiffStyleChange={setAndPersistDiffStyle}
              onOpenFile={onOpenFile}
              onToggleStage={stageSelection}
              onDiscard={entry => void discardSelection(entry)}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      {view !== "history" ? (
        <form
          data-gharargah-git-commit-form=""
          className="shrink-0 border-t border-border/70 bg-card/35 p-3 backdrop-blur-md"
          onSubmit={event => {
            event.preventDefault()
            void commit()
          }}
        >
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <div className="grid min-w-0 gap-1.5">
              <label htmlFor="git-commit-summary" className="sr-only">Commit summary</label>
              <Input
                id="git-commit-summary"
                name="git-commit-summary"
                autoComplete="off"
                value={commitSummary}
                onChange={event => setCommitSummary(event.target.value)}
                placeholder="Commit summary…"
                className="h-8 bg-background/45 text-xs"
              />
              <label htmlFor="git-commit-body" className="sr-only">Commit description</label>
              <textarea
                id="git-commit-body"
                name="git-commit-body"
                value={commitBody}
                onChange={event => setCommitBody(event.target.value)}
                placeholder="Optional description…"
                rows={2}
                className="min-h-12 w-full resize-y rounded-md border border-input bg-background/45 px-3 py-2 font-mono text-2xs leading-4 text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            </div>
            <div className="flex min-w-36 flex-col justify-between gap-2">
              <p className="flex items-center justify-end gap-1.5 text-2xs tabular-nums text-muted-foreground">
                <CheckIcon aria-hidden />
                {stagedCount} {stagedCount === 1 ? "file" : "files"} staged
              </p>
              <Button
                type="submit"
                size="sm"
                disabled={!commitSummary.trim() || stagedCount === 0 || pendingAction !== null}
                data-gharargah-git-commit
              >
                {pendingAction === "Commit" ? <Spinner /> : <CircleDotIcon data-icon="inline-start" />}
                Commit {stagedCount || ""}
              </Button>
            </div>
          </div>
        </form>
      ) : null}
    </section>
  )
}

function GitToolbar(props: {
  repositoryName: string
  summary: GitRepositorySummary
  branches: string[]
  pendingAction: string | null
  onCheckout: (branch: string) => void
  onRemoteAction: (action: "fetch" | "pull" | "push") => void
  onRefresh: () => void
}) {
  const { repositoryName, summary, branches, pendingAction, onCheckout, onRemoteAction, onRefresh } = props
  const busy = pendingAction !== null
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-y border-border/60 bg-card/30 px-3">
      <div className="flex min-w-0 items-center gap-2">
        <GitBranchIcon className="text-foreground" aria-hidden />
        <span className="max-w-40 truncate text-xs font-medium">{repositoryName}</span>
        <label htmlFor="git-branch" className="sr-only">Current branch</label>
        <div className="relative">
          <select
            id="git-branch"
            name="git-branch"
            value={summary.branch ?? ""}
            disabled={busy}
            onChange={event => onCheckout(event.target.value)}
            className="h-8 min-w-32 appearance-none rounded-md border border-input bg-background/55 py-1 pr-7 pl-2 font-mono text-2xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            {summary.branch ? <option value={summary.branch}>{summary.branch}</option> : null}
            {branches.filter(branch => branch !== summary.branch).map(branch => (
              <option key={branch} value={branch}>{branch}</option>
            ))}
          </select>
          <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground" aria-hidden />
        </div>
        <div className="hidden items-center gap-2 text-2xs tabular-nums text-muted-foreground sm:flex">
          <span title={`${summary.ahead} commits ahead`}><ArrowUpIcon className="inline text-emerald-400" aria-hidden /> {summary.ahead}</span>
          <span title={`${summary.behind} commits behind`}><ArrowDownIcon className="inline text-rose-400" aria-hidden /> {summary.behind}</span>
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onRemoteAction("fetch")}>
          {pendingAction === "Fetch" ? <Spinner /> : <ArrowDownIcon data-icon="inline-start" />}
          Fetch
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onRemoteAction("pull")}>
          Pull
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onRemoteAction("push")}>
          <UploadIcon data-icon="inline-start" /> Push
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" disabled={busy} aria-label="Refresh Git" onClick={onRefresh}>
          <RefreshCwIcon className={cn(busy && "animate-spin")} />
        </Button>
      </div>
    </header>
  )
}

function GitViewTabs(props: {
  view: GitView
  stagedCount: number
  historyCount: number
  onChange: (view: GitView) => void
}) {
  const { view, stagedCount, historyCount, onChange } = props
  return (
    <div role="tablist" aria-label="Git views" onKeyDown={handleTabKeyDown} className="flex h-9 shrink-0 items-end gap-1 border-b border-border/60 px-3">
      <GitViewTab active={view === "changes"} label="Changes" onSelect={() => onChange("changes")} />
      <GitViewTab active={view === "staged"} label={`Staged ${stagedCount || ""}`} onSelect={() => onChange("staged")} />
      <GitViewTab active={view === "history"} label={`History ${historyCount || ""}`} onSelect={() => onChange("history")} />
    </div>
  )
}

function GitViewTab(props: { active: boolean; label: string; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.active}
      tabIndex={props.active ? 0 : -1}
      className={cn(
        "relative h-8 px-3 text-2xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
        props.active ? "text-foreground after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:bg-primary" : "text-muted-foreground hover:text-foreground",
      )}
      onClick={props.onSelect}
    >
      {props.label.trim()}
    </button>
  )
}

function FileNavigator(props: {
  rows: NavigationRow[]
  filter: string
  selected: SelectedChange | null
  pending: boolean
  stageAllCount: number
  onFilterChange: (value: string) => void
  onSelect: (selected: SelectedChange) => void
  onToggleStage: (selected: SelectedChange) => void
  onStageAll: () => void
  onOpenFile: (path: string) => void
  onDiscard: (entry: GitStatusEntry) => void
}) {
  const { rows, filter, selected, pending, stageAllCount, onFilterChange, onSelect, onToggleStage, onStageAll, onOpenFile, onDiscard } = props
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: index => rows[index]?.kind === "section" ? 29 : 36,
    overscan: 10,
  })
  const fileRows = rows.filter((row): row is Extract<NavigationRow, { kind: "file" }> => row.kind === "file")

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End", "Enter"].includes(event.key)) return
    if (fileRows.length === 0) return
    const current = fileRows.findIndex(row => row.entry.path === selected?.path && row.staged === selected.staged)
    if (event.key === "Enter") {
      const row = fileRows[Math.max(0, current)]
      if (row) onOpenFile(row.entry.path)
      return
    }
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? fileRows.length - 1
        : Math.max(0, Math.min(fileRows.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)))
    const next = fileRows[nextIndex]
    if (!next) return
    event.preventDefault()
    onSelect({ path: next.entry.path, staged: next.staged })
    const rowIndex = rows.indexOf(next)
    if (rowIndex >= 0) virtualizer.scrollToIndex(rowIndex, { align: "auto" })
  }

  return (
    <aside className="flex h-full min-h-0 flex-col bg-card/15" aria-label="Changed files">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/50 p-2">
        <div className="relative min-w-0 flex-1">
          <label htmlFor="git-filter-files" className="sr-only">Filter changed files</label>
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            id="git-filter-files"
            name="git-filter-files"
            aria-label="Filter changed files"
            autoComplete="off"
            value={filter}
            onChange={event => onFilterChange(event.target.value)}
            placeholder="Filter files…"
            className="h-8 bg-background/35 pl-7 text-xs"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={pending || stageAllCount === 0}
          aria-label={`Stage all ${stageAllCount} changed ${stageAllCount === 1 ? "file" : "files"}`}
          data-gharargah-git-stage-all
          onClick={onStageAll}
        >
          Stage all
        </Button>
      </div>
      <div
        ref={scrollRef}
        data-gharargah-list-panel="git-files"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
      >
        {rows.length === 0 ? (
          <Empty className="h-full rounded-none border-0 p-6">
            <EmptyHeader>
              <EmptyMedia variant="icon"><CheckIcon aria-hidden /></EmptyMedia>
              <EmptyTitle className="text-sm">No matching changes</EmptyTitle>
              <EmptyDescription>{filter ? "Try a different file filter." : "Your working tree is clean."}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map(item => {
              const row = rows[item.index]
              if (!row) return null
              return (
                <div
                  key={row.id}
                  className="absolute top-0 left-0 w-full"
                  style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                >
                  {row.kind === "section" ? (
                    <div className="flex h-full items-center justify-between border-b border-border/30 px-3 font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
                      <span>{row.label}</span><span className="tabular-nums">{row.count}</span>
                    </div>
                  ) : (
                    <GitFileRow
                      entry={row.entry}
                      staged={row.staged}
                      active={selected?.path === row.entry.path && selected.staged === row.staged}
                      pending={pending}
                      onSelect={() => onSelect({ path: row.entry.path, staged: row.staged })}
                      onToggleStage={() => onToggleStage({ path: row.entry.path, staged: row.staged })}
                      onOpenFile={() => onOpenFile(row.entry.path)}
                      onDiscard={() => onDiscard(row.entry)}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </aside>
  )
}

function GitFileRow(props: {
  entry: GitStatusEntry
  staged: boolean
  active: boolean
  pending: boolean
  onSelect: () => void
  onToggleStage: () => void
  onOpenFile: () => void
  onDiscard: () => void
}) {
  const { entry, staged, active, pending, onSelect, onToggleStage, onOpenFile, onDiscard } = props
  return (
    <div
      data-gharargah-list-item=""
      data-gharargah-git-file={entry.path}
      data-active={active ? "" : undefined}
      className={cn(
        "group relative flex h-full shrink-0 items-center gap-2 border-b border-border/20 px-2 text-2xs outline-none transition-colors",
        active ? "bg-primary/10 text-foreground before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:bg-primary" : "text-muted-foreground hover:bg-accent/35 hover:text-foreground",
      )}
    >
      <Checkbox
        checked={staged}
        disabled={pending}
        aria-label={`${staged ? "Unstage" : "Stage"} ${entry.path}`}
        onCheckedChange={onToggleStage}
        className="size-3.5"
      />
      <button type="button" className="min-w-0 flex-1 truncate text-left outline-none focus-visible:underline" onClick={onSelect} onDoubleClick={onOpenFile}>
        <span className="truncate">{entry.path}</span>
      </button>
      <span className={cn("shrink-0 font-mono text-[10px] font-medium", statusColor(entry.status))} title={entry.status}>
        {statusLetter(entry.status)}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={`Actions for ${entry.path}`} className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100">
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={onOpenFile}><ExternalLinkIcon /> Open file</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => {
              void navigator.clipboard.writeText(entry.path)
              showGharargahToast("Path copied")
            }}><CopyIcon /> Copy path</DropdownMenuItem>
            {entry.status !== "untracked" && !staged ? (
              <DropdownMenuItem variant="destructive" onSelect={onDiscard}><RotateCcwIcon /> Discard changes</DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function DiffViewer(props: {
  selected: SelectedChange | null
  selectedEntry?: GitStatusEntry
  patch: string
  loading: boolean
  diffStyle: DiffStyle
  pending: boolean
  onDiffStyleChange: (style: DiffStyle) => void
  onOpenFile: (path: string) => void
  onToggleStage: (selected: SelectedChange) => void
  onDiscard: (entry: GitStatusEntry) => void
}) {
  const { selected, selectedEntry, patch, loading, diffStyle, pending, onDiffStyleChange, onOpenFile, onToggleStage, onDiscard } = props
  if (!selected) {
    return <CenteredEmpty title="Select a changed file" description="Choose a file to inspect its diff." />
  }
  return (
    <div data-gharargah-git-diff="" className="flex h-full min-h-0 flex-col overflow-hidden bg-background/35">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-card/25 px-3">
        <FileDiffIcon className="text-primary" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-mono text-2xs">{selected.path}</span>
        <Button type="button" variant="ghost" size="xs" onClick={() => onOpenFile(selected.path)}>
          <ExternalLinkIcon data-icon="inline-start" /> Open file
        </Button>
        {!selected.staged && selectedEntry && selectedEntry.status !== "untracked" ? (
          <Button type="button" variant="ghost" size="xs" disabled={pending} onClick={() => onDiscard(selectedEntry)}>
            <RotateCcwIcon data-icon="inline-start" /> Discard file
          </Button>
        ) : null}
        <div className="flex rounded-md border border-input bg-background/35 p-0.5" aria-label="Diff layout">
          {(["unified", "split"] as const).map(style => (
            <button
              key={style}
              type="button"
              aria-pressed={diffStyle === style}
              className={cn("h-6 rounded-sm px-2 text-[10px] capitalize text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50", diffStyle === style && "bg-primary/15 text-foreground")}
              onClick={() => onDiffStyleChange(style)}
            >{style}</button>
          ))}
        </div>
        <Button type="button" variant="outline" size="xs" disabled={pending} onClick={() => onToggleStage(selected)}>
          {selected.staged ? "Unstage file" : "Stage file"}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <CenteredStatus label="Loading diff…" />
        ) : patch ? (
          <PatchDiff
            patch={patch}
            options={{ diffStyle, disableFileHeader: true, lineHoverHighlight: "line" }}
          />
        ) : (
          <CenteredEmpty
            title={selectedEntry?.status === "untracked" ? "Untracked file" : "No textual diff"}
            description={selectedEntry?.status === "untracked" ? "Stage this file to inspect its complete patch." : "This file may be binary or unchanged in this Git area."}
          />
        )}
      </div>
    </div>
  )
}

function HistoryList({ commits }: { commits: GitCommit[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: commits.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 54,
    overscan: 10,
  })
  return (
    <div ref={scrollRef} data-gharargah-list-panel="git-history" className="min-h-0 flex-1 overflow-auto p-2">
      {commits.length === 0 ? (
        <CenteredEmpty title="No commit history" description="Commits will appear here once this repository has history." />
      ) : (
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map(item => {
            const commit = commits[item.index]
            if (!commit) return null
            return (
              <article
                key={commit.hash}
                data-gharargah-list-item=""
                className="absolute top-0 left-0 grid w-full shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border/35 px-3 py-2 hover:bg-accent/25"
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
              >
                <HistoryIcon className="text-primary/80" aria-hidden />
                <div className="min-w-0">
                  <span className="block truncate text-xs text-foreground">{commit.subject}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{commit.author}</span>
                </div>
                <div className="text-right font-mono text-[10px] tabular-nums text-muted-foreground">
                  <span className="block text-primary/90">{commit.shortHash}</span>
                  <span className="block">{dateFormatter.format(new Date(commit.authoredAt))}</span>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CenteredStatus({ label }: { label: string }) {
  return <div className="flex h-full min-h-32 items-center justify-center gap-2 text-xs text-muted-foreground"><Spinner /> {label}</div>
}

function CenteredEmpty({ title, description }: { title: string; description: string }) {
  return (
    <Empty className="h-full rounded-none border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon"><FileDiffIcon aria-hidden /></EmptyMedia>
        <EmptyTitle className="text-sm">{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function buildNavigationRows(entries: GitStatusEntry[], view: GitView): NavigationRow[] {
  const rows: NavigationRow[] = []
  const addSection = (id: string, label: string, files: GitStatusEntry[], staged: boolean) => {
    if (files.length === 0) return
    rows.push({ kind: "section", id: `section:${id}`, label, count: files.length })
    for (const entry of files) rows.push({ kind: "file", id: `${id}:${entry.path}`, entry, staged })
  }
  if (view === "staged") {
    addSection("staged", "Staged Changes", entries.filter(entry => entry.staged), true)
    return rows
  }
  addSection("conflicts", "Conflicts", entries.filter(entry => entry.status === "conflict"), false)
  addSection("staged", "Staged Changes", entries.filter(entry => entry.staged && entry.status !== "conflict"), true)
  addSection("changes", "Changes", entries.filter(entry => entry.unstaged && entry.status !== "conflict"), false)
  return rows
}

function statusLetter(status: GitStatusEntry["status"]): string {
  return status === "modified" ? "M" : status === "added" ? "A" : status === "deleted" ? "D" : status === "renamed" ? "R" : status === "untracked" ? "U" : "!"
}

function statusColor(status: GitStatusEntry["status"]): string {
  if (status === "deleted" || status === "conflict") return "text-rose-400"
  if (status === "added" || status === "untracked") return "text-emerald-400"
  return "text-sky-400"
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
  if (tabs.length === 0) return
  const current = Math.max(0, tabs.indexOf(document.activeElement as HTMLButtonElement))
  const next = event.key === "Home"
    ? 0
    : event.key === "End"
      ? tabs.length - 1
      : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length
  event.preventDefault()
  tabs[next]?.focus()
  tabs[next]?.click()
}
