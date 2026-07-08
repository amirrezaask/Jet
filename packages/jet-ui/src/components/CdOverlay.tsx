import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import { ArrowLeft, Folder, SearchIcon } from "lucide-react"
import { pathToFileUri } from "@jet/shared"
import {
  applyPathCompletion,
  deletePathSegmentBackward,
  parsePathCompletionContext,
  resolvePathForOpen,
} from "@jet/workspace"
import {
  Command,
  CommandEmpty,
  CommandItem,
  CommandList,
} from "@/components/ui/command.js"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog.js"
import { Button } from "@/components/ui/button.js"
import { KeyBindingKbd } from "./KeyBindingKbd.js"
import { formatKeyBinding } from "@/lib/format-key.js"
import { COMMAND_NO_SELECTION } from "@/lib/command-shell.js"
import { cn } from "@/lib/utils.js"

type DirEntry = {
  uri: string
  name: string
}

const PARENT_VALUE = "__parent__"
const MAX_DIR_ENTRIES = 500

function isListNavModified(e: KeyboardEvent): boolean {
  return e.shiftKey || e.metaKey || e.ctrlKey || e.altKey
}

function goUp(input: string, homeDir: string): { value: string; cursor: number } {
  const trimmed = input.replace(/[/\\]+$/, "")
  const sep = input.includes("\\") ? "\\" : "/"
  const lastSep = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"))
  let next: string
  if (lastSep <= 0) {
    if (trimmed.startsWith("/")) next = "/"
    else next = homeDir + sep
  } else {
    next = trimmed.slice(0, lastSep) + sep
  }
  return { value: next, cursor: next.length }
}

export type CdOverlayProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialPath: string | null
  onSelectFolder: (absPath: string) => void | Promise<void>
  resolveHomeDir?: () => Promise<string>
  workspaceFolders?: { name: string; path: string }[]
  title?: string
  description?: string
  primaryHint?: string
}

export function CdOverlay({
  open,
  onOpenChange,
  initialPath,
  onSelectFolder,
  resolveHomeDir,
  workspaceFolders,
  title = "Change directory",
  description = "Path to folder",
  primaryHint = "Open",
}: CdOverlayProps) {
  const [pathInput, setPathInput] = useState("")
  const [cursor, setCursor] = useState(0)
  const [homeDir, setHomeDir] = useState("")
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedValue, setSelectedValue] = useState<string>(COMMAND_NO_SELECTION)
  const [showWorkspaceRoots, setShowWorkspaceRoots] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const resolveHomeDirRef = useRef(resolveHomeDir)
  resolveHomeDirRef.current = resolveHomeDir

  const deferredPathInput = useDeferredValue(pathInput)
  const deferredCursor = useDeferredValue(cursor)

  const completionCtx = useMemo(() => {
    if (!homeDir) return null
    return parsePathCompletionContext(deferredPathInput, deferredCursor, homeDir)
  }, [deferredPathInput, deferredCursor, homeDir])

  useEffect(() => {
    if (!open) {
      setPathInput("")
      setCursor(0)
      setHomeDir("")
      setEntries([])
      setError(null)
      setLoading(false)
      setSelectedValue(COMMAND_NO_SELECTION)
      setShowWorkspaceRoots(false)
      return
    }

    const multiRoot = (workspaceFolders?.length ?? 0) > 1
    setShowWorkspaceRoots(multiRoot)

    let cancelled = false
    void (async () => {
      const resolve = resolveHomeDirRef.current
      let home = ""
      if (resolve) {
        try {
          home = await resolve()
        } catch {
          if (!cancelled) setError("Could not resolve a starting directory.")
          return
        }
      }
      if (cancelled) return
      setHomeDir(home)
      if (!multiRoot) {
        const start = initialPath ?? home
        const withSep = start.endsWith("/") || start.endsWith("\\") ? start : `${start}/`
        setPathInput(withSep)
        setCursor(withSep.length)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, initialPath, workspaceFolders])

  useEffect(() => {
    if (!open || !completionCtx || !window.jet?.fs || showWorkspaceRoots) {
      setEntries([])
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    void window.jet.fs
      .readDir(pathToFileUri(completionCtx.parentPath))
      .then(list => {
        if (cancelled) return
        setEntries(
          list
            .filter(e => e.isDirectory)
            .map(e => ({ uri: e.uri, name: e.name }))
            .sort((a, b) => a.name.localeCompare(b.name))
            .slice(0, MAX_DIR_ENTRIES),
        )
      })
      .catch(() => {
        if (!cancelled) {
          setEntries([])
          setError("Cannot read this directory.")
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, completionCtx?.parentPath, showWorkspaceRoots])

  const workspaceRootItems = useMemo(() => {
    if (!showWorkspaceRoots || !workspaceFolders) return []
    const q = pathInput.trim().toLowerCase()
    return workspaceFolders.filter(
      f =>
        !q ||
        f.name.toLowerCase().includes(q) ||
        f.path.toLowerCase().includes(q),
    )
  }, [showWorkspaceRoots, workspaceFolders, pathInput])

  const pickWorkspaceRoot = useCallback(
    (path: string) => {
      setShowWorkspaceRoots(false)
      const withSep = path.endsWith("/") || path.endsWith("\\") ? path : `${path}/`
      setPathInput(withSep)
      setCursor(withSep.length)
      requestAnimationFrame(() => {
        const el = inputRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(withSep.length, withSep.length)
      })
    },
    [],
  )

  const completions = useMemo(() => {
    if (!completionCtx) return []
    const prefix = completionCtx.partial.toLowerCase()
    return entries.filter(e => e.name.toLowerCase().startsWith(prefix))
  }, [completionCtx, entries])

  const ghostCompletion = useMemo(() => {
    if (!completionCtx || completions.length === 0) return ""
    const partial = completionCtx.partial
    const first = completions[0]!.name
    if (!partial) return ""
    if (!first.toLowerCase().startsWith(partial.toLowerCase())) return ""
    return first.slice(partial.length)
  }, [completionCtx, completions])

  useEffect(() => {
    if (showWorkspaceRoots) {
      if (workspaceRootItems.length === 0) {
        setSelectedValue(COMMAND_NO_SELECTION)
        return
      }
      const first = workspaceRootItems[0]!.path
      setSelectedValue(prev => (workspaceRootItems.some(f => f.path === prev) ? prev : first))
      return
    }
    if (completions.length === 0) {
      setSelectedValue(PARENT_VALUE)
      return
    }
    const firstUri = completions[0]!.uri
    setSelectedValue(prev => {
      if (prev === PARENT_VALUE) return prev
      if (completions.some(e => e.uri === prev)) return prev
      return firstUri
    })
  }, [completions, showWorkspaceRoots, workspaceRootItems])

  const syncCursorFromInput = useCallback(() => {
    const el = inputRef.current
    if (el) setCursor(el.selectionStart ?? el.value.length)
  }, [])

  const applyCompletion = useCallback(
    (dirName: string) => {
      if (!completionCtx) return
      const { value, cursor: nextCursor } = applyPathCompletion(pathInput, completionCtx, dirName)
      setPathInput(value)
      setCursor(nextCursor)
      requestAnimationFrame(() => {
        const el = inputRef.current
        if (!el) return
        el.focus()
        el.setSelectionRange(nextCursor, nextCursor)
      })
    },
    [completionCtx, pathInput],
  )

  const doGoUp = useCallback(() => {
    if (!homeDir) return
    const { value, cursor: nextCursor } = goUp(pathInput, homeDir)
    setPathInput(value)
    setCursor(nextCursor)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(nextCursor, nextCursor)
    })
  }, [homeDir, pathInput])

  const submit = useCallback(() => {
    if (!homeDir || !pathInput.trim()) return
    const path = resolvePathForOpen(pathInput, homeDir)
    onOpenChange(false)
    void Promise.resolve(onSelectFolder(path)).catch(err => {
      console.warn("Failed to select folder:", err)
    })
  }, [homeDir, pathInput, onSelectFolder, onOpenChange])

  const moveHighlight = useCallback(
    (delta: 1 | -1) => {
      if (showWorkspaceRoots) {
        if (workspaceRootItems.length === 0) return
        const idx = Math.max(
          0,
          workspaceRootItems.findIndex(f => f.path === selectedValue),
        )
        const next = (idx + delta + workspaceRootItems.length) % workspaceRootItems.length
        setSelectedValue(workspaceRootItems[next]!.path)
        return
      }
      const flat: string[] = [PARENT_VALUE, ...completions.map(c => c.uri)]
      if (flat.length === 0) return
      const idx = Math.max(0, flat.indexOf(selectedValue))
      const next = (idx + delta + flat.length) % flat.length
      setSelectedValue(flat[next]!)
    },
    [completions, selectedValue, showWorkspaceRoots, workspaceRootItems],
  )

  const highlightedEntry = useMemo(() => {
    if (showWorkspaceRoots) {
      return workspaceRootItems.find(f => f.path === selectedValue) ?? null
    }
    if (selectedValue === PARENT_VALUE) return null
    return completions.find(e => e.uri === selectedValue) ?? null
  }, [completions, selectedValue, showWorkspaceRoots, workspaceRootItems])

  const canSubmit = Boolean(homeDir && pathInput.trim())

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="overflow-hidden p-0 sm:max-w-2xl"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <Command
          shouldFilter={false}
          value={selectedValue}
          onValueChange={setSelectedValue}
          className="border-0"
        >
          <div
            data-slot="command-input-wrapper"
            className="flex items-center gap-2 border-b border-border px-3 py-2"
          >
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="relative min-w-0 flex-1">
              <input
                ref={inputRef}
                type="text"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                placeholder="Path to folder…"
                value={pathInput}
                onChange={e => {
                  setPathInput(e.target.value)
                  setCursor(e.target.selectionStart ?? e.target.value.length)
                }}
                onKeyUp={syncCursorFromInput}
                onClick={syncCursorFromInput}
                onKeyDown={e => {
                  if (e.altKey && e.key === "Backspace") {
                    const el = inputRef.current
                    if (!el) return
                    const start = el.selectionStart ?? pathInput.length
                    const end = el.selectionEnd ?? pathInput.length
                    const result = deletePathSegmentBackward(pathInput, start, end)
                    if (!result) return
                    e.preventDefault()
                    setPathInput(result.value)
                    setCursor(result.cursor)
                    requestAnimationFrame(() => {
                      el.setSelectionRange(result.cursor, result.cursor)
                    })
                    return
                  }

                  if (e.key === "ArrowDown" && !isListNavModified(e)) {
                    e.preventDefault()
                    moveHighlight(1)
                    return
                  }
                  if (e.key === "ArrowUp" && !isListNavModified(e)) {
                    e.preventDefault()
                    moveHighlight(-1)
                    return
                  }

                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    submit()
                    return
                  }

                  if (e.key === "Enter" || e.key === "Tab") {
                    if (showWorkspaceRoots) {
                      const root = workspaceRootItems.find(f => f.path === selectedValue)
                      if (!root) return
                      e.preventDefault()
                      pickWorkspaceRoot(root.path)
                      return
                    }
                    if (selectedValue === PARENT_VALUE) {
                      e.preventDefault()
                      doGoUp()
                      return
                    }
                    if (!highlightedEntry || !("uri" in highlightedEntry)) return
                    e.preventDefault()
                    applyCompletion(highlightedEntry.name)
                  }
                }}
                className="w-full bg-transparent font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground"
                aria-controls="jet-cd-list"
              />
              {ghostCompletion ? (
                <span
                  className="pointer-events-none absolute inset-0 flex items-center whitespace-pre font-mono text-sm text-muted-foreground/60"
                  aria-hidden
                >
                  <span className="invisible">{pathInput}</span>
                  <span>{ghostCompletion}</span>
                </span>
              ) : null}
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!canSubmit}
              onClick={submit}
              className="h-8 gap-1.5 whitespace-nowrap"
            >
              {primaryHint}
              <KeyBindingKbd binding={formatKeyBinding("Mod-Enter")} />
            </Button>
          </div>
          <CommandList
            id="jet-cd-list"
            className="max-h-[var(--jet-overlay-list-max,22rem)]"
          >
            {error ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">{error}</div>
            ) : showWorkspaceRoots ? (
              <>
                <CommandEmpty>No matching workspace folders.</CommandEmpty>
                <CommandItem value={COMMAND_NO_SELECTION} className="hidden" aria-hidden />
                {workspaceRootItems.map(folder => (
                  <CommandItem
                    key={folder.path}
                    value={folder.path}
                    onSelect={() => pickWorkspaceRoot(folder.path)}
                    className="gap-2"
                  >
                    <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-mono text-foreground">{folder.name}</span>
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {folder.path}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </>
            ) : !homeDir || loading ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">Loading…</div>
            ) : (
              <>
                <CommandItem value={COMMAND_NO_SELECTION} className="hidden" aria-hidden />
                <CommandItem
                  key="__parent__"
                  value={PARENT_VALUE}
                  onSelect={doGoUp}
                  className="gap-2"
                >
                  <ArrowLeft className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="font-mono text-foreground">..</span>
                </CommandItem>
                {completions.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    No matching directories.
                  </div>
                ) : null}
                {completions.map(entry => (
                  <CommandItem
                    key={entry.uri}
                    value={entry.uri}
                    onSelect={() => applyCompletion(entry.name)}
                    className="gap-2"
                  >
                    <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate font-mono">{entry.name}</span>
                  </CommandItem>
                ))}
              </>
            )}
          </CommandList>
          <div
            className={cn(
              "flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-muted/30",
              "px-3 py-1.5 text-2xs text-muted-foreground",
            )}
          >
            <HintKey binding="ArrowUp" label="Navigate" extra="ArrowDown" />
            <HintKey binding="Tab" label="Autocomplete" extra="Enter" />
            <HintKey binding={formatKeyBinding("Mod-Enter")} label={primaryHint} />
            <HintKey binding={formatKeyBinding("Alt-Backspace")} label="Go back" />
            <HintKey binding="Escape" label="Close" />
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

function HintKey({
  binding,
  label,
  extra,
}: {
  binding: string
  label: string
  extra?: string
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <KeyBindingKbd binding={binding} />
      {extra ? <KeyBindingKbd binding={extra} /> : null}
      <span>{label}</span>
    </span>
  )
}
