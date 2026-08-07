import { useEffect, useMemo, useState } from "react"
import type { GitWorktree } from "@yaade/shared"
import { pathToFileUri } from "@yaade/shared"
import { cn, yaadePressClass } from "@yaade/ui/project"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@yaade/ui/primitives"
import {
  CheckIcon,
  ChevronDownIcon,
  GitBranchIcon,
  PlusIcon,
} from "lucide-react"
import { CreateWorktreeDialog } from "./CreateWorktreeDialog.js"

export type WorktreeSwitcherProps = {
  projectPath: string
  homeDir: string
  defaultBranch: string
  /** True when the worktree tiling view is showing. */
  active?: boolean
  /** Currently open checkout label (shown on the trigger). */
  activeLabel?: string | null
  /** Absolute cwd of the open checkout (for menu checkmarks). */
  activeCwdPath?: string | null
  onSelectCheckout: (input: {
    cwdPath: string
    title?: string
    worktreeBranch?: string | null
    worktreePath?: string | null
  }) => Promise<void>
  onCreateWorktree: (input: {
    branch: string
    baseRef?: string
  }) => Promise<void>
  /** Warm the session workspace when the user signals intent to open it. */
  onIntent?: () => void
}

function branchLabel(wt: GitWorktree): string {
  if (wt.branch) return wt.branch.replace(/^refs\/heads\//, "")
  if (wt.detached && wt.head) return `detached@${wt.head.slice(0, 7)}`
  return wt.path.split("/").filter(Boolean).pop() ?? wt.path
}

export function WorktreeSwitcher({
  projectPath,
  homeDir,
  defaultBranch,
  active = false,
  activeLabel,
  activeCwdPath,
  onSelectCheckout,
  onCreateWorktree,
  onIntent,
}: WorktreeSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [worktrees, setWorktrees] = useState<GitWorktree[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [highlight, setHighlight] = useState("main")
  const rootUri = useMemo(() => pathToFileUri(projectPath), [projectPath])

  const linked = useMemo(() => {
    if (!worktrees) return []
    return worktrees.filter(
      wt => !wt.bare && wt.path !== projectPath && !wt.prunable,
    )
  }, [projectPath, worktrees])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void window.yaade?.git
      ?.worktreeList(rootUri)
      .then(rows => {
        if (cancelled) return
        setWorktrees(rows)
      })
      .catch(err => {
        if (cancelled) return
        setWorktrees([])
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, rootUri])

  const selectMain = async () => {
    setBusy(true)
    try {
      await onSelectCheckout({
        cwdPath: projectPath,
        title: "Main",
      })
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const selectWorktree = async (wt: GitWorktree) => {
    setBusy(true)
    try {
      const branch = wt.branch
        ? wt.branch.replace(/^refs\/heads\//, "")
        : null
      await onSelectCheckout({
        cwdPath: wt.path,
        title: branch ?? branchLabel(wt),
        worktreeBranch: branch,
        worktreePath: wt.path,
      })
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const handleCreate = async (input: { branch: string; baseRef?: string }) => {
    await onCreateWorktree(input)
    setCreateOpen(false)
    setOpen(false)
  }

  return (
    <>
      <Popover
        open={open}
        onOpenChange={next => {
          if (next) onIntent?.()
          setOpen(next)
          if (!next) {
            setError(null)
            setHighlight("main")
          }
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            data-yaade-worktree-switcher=""
            data-yaade-project-tab="worktrees"
            aria-label="Worktrees"
            aria-expanded={open}
            disabled={busy}
            onPointerEnter={onIntent}
            onFocus={onIntent}
            className={cn(
              yaadePressClass,
              "relative inline-flex h-[calc(100%-1px)] items-center justify-center gap-0.5 rounded-md border border-transparent px-1.5 py-0 text-xs font-medium whitespace-nowrap text-foreground/60 outline-none",
              "hover:text-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/60",
              "dark:text-muted-foreground dark:hover:text-foreground",
              "after:absolute after:inset-x-0 after:bottom-0.5 after:h-0.5 after:bg-foreground after:opacity-0 after:transition-opacity",
              (open || active) && "text-foreground",
              active && "after:opacity-100",
            )}
          >
            Worktrees
            {activeLabel ? (
              <span className="hidden max-w-[7rem] truncate font-normal text-foreground/80 sm:inline">
                · {activeLabel}
              </span>
            ) : null}
            <ChevronDownIcon className="size-2.5 opacity-70" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-72 p-0"
          data-yaade-worktree-switcher-menu=""
          onOpenAutoFocus={e => {
            e.preventDefault()
            const root = e.currentTarget as HTMLElement
            root
              .querySelector<HTMLInputElement>(
                "[data-yaade-worktree-switcher-search]",
              )
              ?.focus()
          }}
          onCloseAutoFocus={e => e.preventDefault()}
        >
          <Command
            value={highlight}
            onValueChange={setHighlight}
            className="rounded-md"
          >
            <CommandInput
              placeholder="Filter worktrees…"
              aria-label="Filter worktrees"
              data-yaade-worktree-switcher-search=""
            />
            <CommandList className="max-h-72">
              {loading ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  Loading…
                </div>
              ) : error ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  {error}
                </div>
              ) : (
                <>
                  <CommandEmpty className="py-3 text-xs">
                    No matches
                  </CommandEmpty>
                  <CommandGroup heading="Checkout">
                    <CommandItem
                      value="main"
                      data-yaade-worktree-main=""
                      disabled={busy}
                      onSelect={() => void selectMain()}
                      className="gap-2"
                    >
                      <CheckIcon
                        className={cn(
                          "size-3.5 shrink-0",
                          activeCwdPath === projectPath
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                      <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-sm">
                          Main working tree
                        </span>
                        <span className="block truncate font-mono text-3xs text-muted-foreground">
                          {projectPath}
                        </span>
                      </div>
                    </CommandItem>
                    {linked.map(wt => {
                      const label = branchLabel(wt)
                      const selected = activeCwdPath === wt.path
                      return (
                        <CommandItem
                          key={wt.path}
                          value={`${label} ${wt.path}`}
                          data-yaade-worktree-item={label}
                          disabled={busy}
                          onSelect={() => void selectWorktree(wt)}
                          className="gap-2"
                        >
                          <CheckIcon
                            className={cn(
                              "size-3.5 shrink-0",
                              selected ? "opacity-100" : "opacity-0",
                            )}
                          />
                          <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <span className="block truncate text-sm">
                              {label}
                            </span>
                            <span className="block truncate font-mono text-3xs text-muted-foreground">
                              {wt.path}
                            </span>
                          </div>
                        </CommandItem>
                      )
                    })}
                  </CommandGroup>
                  <CommandSeparator />
                  <CommandGroup>
                    <CommandItem
                      value="create new worktree"
                      data-yaade-worktree-create=""
                      disabled={busy}
                      onSelect={() => {
                        setOpen(false)
                        setCreateOpen(true)
                      }}
                      className="gap-2"
                    >
                      <PlusIcon className="size-3.5 shrink-0" />
                      <span>Create worktree…</span>
                    </CommandItem>
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <CreateWorktreeDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectPath={projectPath}
        homeDir={homeDir}
        defaultBranch={defaultBranch}
        onCreate={handleCreate}
      />
    </>
  )
}
