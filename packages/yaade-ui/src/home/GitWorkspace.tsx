import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import type { GitCommit, GitRepositorySummary, GitStatusEntry, YaadeTheme } from "@yaade/shared"
import { fileUriToPath, languageIdFromPath, pathToFileUri } from "@yaade/shared"
import { MonacoDiffEditorHost, monacoLanguageId } from "@yaade/monaco"
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
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog.js"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
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
import { Label } from "@/components/ui/label.js"
import { Spinner } from "@/components/ui/spinner.js"
import { Textarea } from "@/components/ui/textarea.js"
import { cn } from "@/lib/utils.js"
import { requestConfirm } from "@/components/ConfirmDialogHost.js"
import { showYaadeToast } from "@/toast.js"
import { SessionHeaderChromePortal } from "./session-header-chrome.js"

type GitWorkspaceProps = {
  rootUri: string | null
  theme: YaadeTheme
  onOpenFile: (path: string) => void
  onBranchChange?: (branch: string | null) => void
  /** When set, select this path in Changes (agent openDiff / deep-link). */
  focusPath?: string | null
}

type DiffContents = {
  original: string
  modified: string
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
  const { rootUri, theme, onOpenFile, onBranchChange, focusPath } = props
  const api = window.yaade?.git
  const fsApi = window.yaade?.fs
  const [isRepo, setIsRepo] = useState<boolean | null>(null)
  const [entries, setEntries] = useState<GitStatusEntry[]>([])
  const [summary, setSummary] = useState<GitRepositorySummary>(EMPTY_SUMMARY)
  const [branches, setBranches] = useState<string[]>([])
  const [history, setHistory] = useState<GitCommit[]>([])
  const [view, setView] = useState<GitView>("changes")
  const [selected, setSelected] = useState<SelectedChange | null>(null)
  const [filter, setFilter] = useState("")
  const [diffContents, setDiffContents] = useState<DiffContents | null>(null)
  const [diffStyle, setDiffStyle] = useState<DiffStyle>(() =>
    localStorage.getItem("yaade:git-diff-style") === "split" ? "split" : "unified",
  )
  const [loading, setLoading] = useState(true)
  const [diffLoading, setDiffLoading] = useState(false)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
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
      showYaadeToast("Could not refresh Git", {
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
    if (!rootUri || !api || !fsApi || !selected) {
      setDiffContents(null)
      return
    }
    const entry = entries.find(item => item.path === selected.path)
    const request = ++diffRequest.current
    setDiffLoading(true)
    void loadGitDiffContents(rootUri, selected, entry, api, fsApi)
      .then(contents => {
        if (request === diffRequest.current) setDiffContents(contents)
      })
      .catch(error => {
        if (request !== diffRequest.current) return
        setDiffContents(null)
        showYaadeToast("Could not load diff", {
          variant: "destructive",
          description: errorMessage(error),
        })
      })
      .finally(() => {
        if (request === diffRequest.current) setDiffLoading(false)
      })
  }, [api, fsApi, rootUri, selected, entries])

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

  useEffect(() => {
    if (!focusPath) return
    const needle = focusPath.replace(/\\/g, "/").replace(/^\/+/, "")
    const match = entries.find(entry => {
      const path = entry.path.replace(/\\/g, "/")
      return path === needle || path.endsWith(`/${needle}`) || needle.endsWith(`/${path}`)
    })
    if (!match) return
    setView(match.staged && !match.unstaged ? "staged" : "changes")
    setSelected({ path: match.path, staged: Boolean(match.staged && !match.unstaged) })
  }, [focusPath, entries])

  const runAction = useCallback(
    async (label: string, task: () => Promise<void>, success?: string): Promise<boolean> => {
      setPendingAction(label)
      try {
        await task()
        if (success) showYaadeToast(success, { variant: "success" })
        await refresh()
        return true
      } catch (error) {
        showYaadeToast(`${label} failed`, {
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
    localStorage.setItem("yaade:git-diff-style", next)
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

  const commit = async (summaryText: string, bodyText: string): Promise<boolean> => {
    const message = summaryText.trim()
    if (!rootUri || !api || !message || stagedCount === 0) return false
    const committed = await runAction(
      "Commit",
      () => api.commit(rootUri, message, bodyText.trim() || undefined),
      `Committed ${stagedCount} ${stagedCount === 1 ? "file" : "files"}`,
    )
    return committed
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

  const onCheckout = (branch: string) => {
    if (!rootUri || !api || branch === summary.branch) return
    void runAction("Switch branch", () => api.checkout(rootUri, branch), `Switched to ${branch}`)
  }

  return (
    <section
      data-yaade-git-workspace=""
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-transparent"
      aria-label="Git workspace"
    >
      <SessionHeaderChromePortal active>
        <GitBranchHeaderControls
          summary={summary}
          branches={branches}
          pending={pendingAction !== null}
          onCheckout={onCheckout}
        />
      </SessionHeaderChromePortal>

      <GitToolbar
        repositoryKey={rootUri}
        summary={summary}
        view={view}
        stagedCount={stagedCount}
        pendingAction={pendingAction}
        onViewChange={setView}
        onCommit={commit}
        onRemoteAction={action => {
          if (!rootUri || !api) return
          const task = action === "fetch" ? api.fetch : action === "pull" ? api.pull : api.push
          void runAction(capitalize(action), () => task.call(api, rootUri), `${capitalize(action)} complete`)
        }}
        onRefresh={() => void refresh()}
      />

      {view === "history" ? (
        <HistoryList commits={history} />
      ) : (
        <ResizablePanelGroup
          orientation="horizontal"
          data-yaade-git-content=""
          className="min-h-0 flex-1 bg-transparent"
        >
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
              diffContents={diffContents}
              loading={diffLoading}
              diffStyle={diffStyle}
              theme={theme}
              pending={pendingAction !== null}
              onDiffStyleChange={setAndPersistDiffStyle}
              onOpenFile={onOpenFile}
              onToggleStage={stageSelection}
              onDiscard={entry => void discardSelection(entry)}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </section>
  )
}

function GitBranchHeaderControls(props: {
  summary: GitRepositorySummary
  branches: string[]
  pending: boolean
  onCheckout: (branch: string) => void
}) {
  const { summary, branches, pending, onCheckout } = props
  const branchOptions =
    summary.branch && !branches.includes(summary.branch)
      ? [summary.branch, ...branches]
      : branches
  return (
    <div
      data-yaade-session-header-tabs="git"
      className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="max-w-48 gap-1"
            aria-label={
              summary.branch
                ? `Switch branch, current branch ${summary.branch}`
                : "Switch branch"
            }
            data-yaade-git-branch-trigger=""
            disabled={pending}
          >
            <GitBranchIcon className="size-3" />
            <span className="truncate">{summary.branch ?? "Branch"}</span>
            <ChevronDownIcon className="size-2.5 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Switch branch</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={summary.branch ?? ""}
            onValueChange={onCheckout}
          >
            {branchOptions.map(branch => (
              <DropdownMenuRadioItem key={branch} value={branch}>
                {branch}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <div
        aria-label={`${summary.ahead} commits ahead, ${summary.behind} commits behind`}
        className="hidden items-center gap-2 text-2xs tabular-nums text-muted-foreground sm:flex"
      >
        <span title={`${summary.ahead} commits ahead`}>
          <ArrowUpIcon className="inline size-3" aria-hidden /> {summary.ahead}
        </span>
        <span title={`${summary.behind} commits behind`}>
          <ArrowDownIcon className="inline size-3" aria-hidden /> {summary.behind}
        </span>
      </div>
    </div>
  )
}

function GitToolbar(props: {
  repositoryKey: string
  summary: GitRepositorySummary
  view: GitView
  stagedCount: number
  pendingAction: string | null
  onViewChange: (view: GitView) => void
  onCommit: (summary: string, body: string) => Promise<boolean>
  onRemoteAction: (action: "fetch" | "pull" | "push") => void
  onRefresh: () => void
}) {
  const {
    repositoryKey,
    summary,
    view,
    stagedCount,
    pendingAction,
    onViewChange,
    onCommit,
    onRemoteAction,
    onRefresh,
  } = props
  const busy = pendingAction !== null
  return (
    <header
      data-yaade-git-toolbar=""
      data-yaade-liquid-glass="chrome"
      className="flex h-9 shrink-0 items-center gap-2 border-b border-transparent bg-transparent px-2"
    >
      <GitViewTabs
        view={view}
        stagedCount={stagedCount}
        onChange={onViewChange}
      />
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <GitCommitDialog
          key={repositoryKey}
          branch={summary.branch}
          stagedCount={stagedCount}
          busy={busy}
          committing={pendingAction === "Commit"}
          onCommit={onCommit}
        />
        {pendingAction ? (
          <span role="status" className="hidden items-center gap-1.5 text-2xs text-muted-foreground sm:flex">
            <Spinner />
            {pendingAction}…
          </span>
        ) : null}
        <Button type="button" variant="ghost" size="icon-sm" disabled={busy} aria-label="Refresh Git" onClick={onRefresh}>
          <RefreshCwIcon className={cn(busy && "animate-spin")} />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" disabled={busy} aria-label="Repository actions">
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => onRemoteAction("fetch")}>
                <ArrowDownIcon />
                Fetch from remote
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onRemoteAction("pull")}>
                <ArrowDownIcon />
                Pull from remote
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onRemoteAction("push")}>
                <UploadIcon />
                Push to remote
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

function GitCommitDialog(props: {
  branch: string | null
  stagedCount: number
  busy: boolean
  committing: boolean
  onCommit: (summary: string, body: string) => Promise<boolean>
}) {
  const { branch, stagedCount, busy, committing, onCommit } = props
  const [open, setOpen] = useState(false)
  const [summary, setSummary] = useState("")
  const [body, setBody] = useState("")
  const summaryRef = useRef<HTMLInputElement>(null)
  const stagedLabel = `${stagedCount} staged ${stagedCount === 1 ? "file" : "files"}`

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && committing) return
    setOpen(nextOpen)
  }

  const handleSubmit = async () => {
    if (!summary.trim() || stagedCount === 0 || busy) return
    const committed = await onCommit(summary, body)
    if (!committed) return
    setSummary("")
    setBody("")
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="xs"
          disabled={busy || stagedCount === 0}
          aria-label={
            stagedCount === 0
              ? "No staged files to commit"
              : `Commit ${stagedCount} staged ${stagedCount === 1 ? "file" : "files"}`
          }
          data-yaade-git-commit-trigger=""
        >
          <CircleDotIcon data-icon="inline-start" />
          Commit
        </Button>
      </DialogTrigger>
      <DialogContent
        size="prompt"
        motion="standard"
        data-yaade-git-commit-dialog=""
        onOpenAutoFocus={event => {
          event.preventDefault()
          summaryRef.current?.focus()
        }}
        onEscapeKeyDown={event => {
          if (committing) event.preventDefault()
        }}
        onPointerDownOutside={event => {
          if (committing) event.preventDefault()
        }}
      >
        <form
          data-yaade-git-commit-form=""
          aria-busy={committing}
          className="flex flex-col gap-4"
          onSubmit={event => {
            event.preventDefault()
            void handleSubmit()
          }}
        >
          <DialogHeader>
            <DialogTitle>Commit changes</DialogTitle>
            <DialogDescription>
              Commit {stagedLabel} to {branch ?? "the current branch"}.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="git-commit-summary">Summary</Label>
              <Input
                ref={summaryRef}
                id="git-commit-summary"
                name="git-commit-summary"
                autoComplete="off"
                required
                value={summary}
                onChange={event => setSummary(event.target.value)}
                placeholder="Describe the changes"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="git-commit-body">Description</Label>
              <Textarea
                id="git-commit-body"
                name="git-commit-body"
                value={body}
                onChange={event => setBody(event.target.value)}
                placeholder="Add context (optional)"
                rows={4}
                className="min-h-24 resize-y font-mono text-2xs leading-4"
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={committing}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={!summary.trim() || stagedCount === 0 || busy}
              data-yaade-git-commit=""
            >
              {committing ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <CircleDotIcon data-icon="inline-start" />
              )}
              {committing ? "Committing…" : `Commit ${stagedCount} ${stagedCount === 1 ? "file" : "files"}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function GitViewTabs(props: {
  view: GitView
  stagedCount: number
  onChange: (view: GitView) => void
}) {
  const { view, stagedCount, onChange } = props
  return (
    <div
      role="tablist"
      aria-label="Git views"
      onKeyDown={handleTabKeyDown}
      className="flex min-w-0 items-center gap-0.5"
    >
      <GitViewTab active={view === "changes"} label="Changes" onSelect={() => onChange("changes")} />
      <GitViewTab active={view === "staged"} label={`Staged ${stagedCount || ""}`} onSelect={() => onChange("staged")} />
      <GitViewTab active={view === "history"} label="History" onSelect={() => onChange("history")} />
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
      data-yaade-session-tab-pill=""
      data-active={props.active ? "" : undefined}
      className={cn(
        "h-7 rounded-[0.65rem] border px-2.5 text-2xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
        props.active
          ? "border-border/80 bg-card/75 text-foreground shadow-sm"
          : "border-transparent bg-muted/30 text-foreground/70 hover:border-border/60 hover:bg-muted/55 hover:text-foreground",
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
    if (event.target !== event.currentTarget) return
    if (!["ArrowUp", "ArrowDown", "Home", "End", "Enter", " "].includes(event.key)) return
    if (fileRows.length === 0) return
    const current = fileRows.findIndex(row => row.entry.path === selected?.path && row.staged === selected.staged)
    if (event.key === "Enter") {
      const row = fileRows[Math.max(0, current)]
      if (row) onOpenFile(row.entry.path)
      return
    }
    if (event.key === " ") {
      const row = fileRows[Math.max(0, current)]
      if (!row) return
      event.preventDefault()
      onToggleStage({ path: row.entry.path, staged: row.staged })
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
    <aside
      data-yaade-liquid-glass="chrome"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-none border-0 bg-transparent"
      aria-label="Changed files"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border/40 p-2">
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
            className="h-8 bg-background pl-7 text-xs"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={pending || stageAllCount === 0}
          aria-label={`Stage all ${stageAllCount} changed ${stageAllCount === 1 ? "file" : "files"}`}
          data-yaade-git-stage-all
          onClick={onStageAll}
        >
          Stage all
        </Button>
      </div>
      <div
        ref={scrollRef}
        data-yaade-list-panel="git-files"
        tabIndex={0}
        aria-label="Changed files list"
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
      data-yaade-list-item=""
      data-yaade-git-file={entry.path}
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
              showYaadeToast("Path copied")
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
  diffContents: DiffContents | null
  loading: boolean
  diffStyle: DiffStyle
  theme: YaadeTheme
  pending: boolean
  onDiffStyleChange: (style: DiffStyle) => void
  onOpenFile: (path: string) => void
  onToggleStage: (selected: SelectedChange) => void
  onDiscard: (entry: GitStatusEntry) => void
}) {
  const {
    selected,
    selectedEntry,
    diffContents,
    loading,
    diffStyle,
    theme,
    pending,
    onDiffStyleChange,
    onOpenFile,
    onToggleStage,
    onDiscard,
  } = props
  if (!selected) {
    return <CenteredEmpty title="Select a changed file" description="Choose a file to inspect its diff." />
  }
  const languageId = monacoLanguageId(languageIdFromPath(selected.path))
  const originalUri = `git-diff://${selected.path}?side=original&staged=${selected.staged ? "1" : "0"}`
  const modifiedUri = `git-diff://${selected.path}?side=modified&staged=${selected.staged ? "1" : "0"}`
  const hasDiff =
    diffContents != null &&
    (diffContents.original.length > 0 || diffContents.modified.length > 0)
  return (
    <div data-yaade-git-diff="" className="flex h-full min-h-0 flex-col overflow-hidden bg-transparent">
      <div
        data-yaade-git-diff-toolbar=""
        data-yaade-liquid-glass="chrome"
        className="flex h-10 shrink-0 items-center gap-2 border-b border-transparent bg-transparent px-3"
      >
        <FileDiffIcon className="text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-mono text-2xs">{selected.path}</span>
        <Button type="button" variant="secondary" size="xs" disabled={pending} onClick={() => onToggleStage(selected)}>
          {selected.staged ? "Unstage file" : "Stage file"}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={pending}
              aria-label={`Diff actions for ${selected.path}`}
            >
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => onOpenFile(selected.path)}>
                <ExternalLinkIcon />
                Open file
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Diff layout</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={diffStyle}
              onValueChange={value => onDiffStyleChange(value as DiffStyle)}
            >
              <DropdownMenuRadioItem value="unified">Unified</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="split">Split</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            {!selected.staged && selectedEntry && selectedEntry.status !== "untracked" ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem variant="destructive" onSelect={() => onDiscard(selectedEntry)}>
                    <RotateCcwIcon />
                    Discard changes
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {loading ? (
          <CenteredStatus label="Loading diff…" />
        ) : hasDiff && diffContents ? (
          <MonacoDiffEditorHost
            originalUri={originalUri}
            modifiedUri={modifiedUri}
            originalContent={diffContents.original}
            modifiedContent={diffContents.modified}
            languageId={languageId}
            theme={theme}
            readOnly
            renderSideBySide={diffStyle === "split"}
            className="h-full min-h-0"
          />
        ) : (
          <CenteredEmpty
            title={selectedEntry?.status === "untracked" ? "Untracked file" : "No textual diff"}
            description={
              selectedEntry?.status === "untracked"
                ? "New file contents appear after the working tree is readable."
                : "This file may be binary or unchanged in this Git area."
            }
          />
        )}
      </div>
    </div>
  )
}

async function loadGitDiffContents(
  rootUri: string,
  selected: SelectedChange,
  entry: GitStatusEntry | undefined,
  api: NonNullable<NonNullable<typeof window.yaade>["git"]>,
  fsApi: NonNullable<NonNullable<typeof window.yaade>["fs"]>,
): Promise<DiffContents> {
  const rootPath = fileUriToPath(rootUri).replace(/[/\\]+$/, "")
  const fullPath = `${rootPath}/${selected.path.replace(/^[/\\]+/, "")}`
  const fileUri = pathToFileUri(fullPath)

  if (entry?.status === "untracked") {
    try {
      return { original: "", modified: await fsApi.readFile(fileUri) }
    } catch {
      return { original: "", modified: "" }
    }
  }

  if (entry?.status === "deleted") {
    const original = selected.staged
      ? await api.show(rootUri, selected.path, "HEAD")
      : await api.show(rootUri, selected.path, "INDEX")
    return { original, modified: "" }
  }

  if (selected.staged) {
    const [original, modified] = await Promise.all([
      api.show(rootUri, selected.path, "HEAD"),
      api.show(rootUri, selected.path, "INDEX"),
    ])
    return { original, modified }
  }

  const [original, modified] = await Promise.all([
    api.show(rootUri, selected.path, "INDEX").then(
      value => value || api.show(rootUri, selected.path, "HEAD"),
    ),
    fsApi.readFile(fileUri).catch(() => ""),
  ])
  return { original, modified }
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
    <div ref={scrollRef} data-yaade-list-panel="git-history" className="min-h-0 flex-1 overflow-auto p-2">
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
                data-yaade-list-item=""
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
