import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import { Folder } from "lucide-react"
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
  CommandInput,
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

type DirEntry = {
  uri: string
  name: string
}

const MAX_DIR_ENTRIES = 500

function isListNavModified(e: KeyboardEvent): boolean {
  return e.shiftKey || e.metaKey || e.ctrlKey || e.altKey
}

export function CdOverlay({
  open,
  onOpenChange,
  initialPath,
  onSelectFolder,
  resolveHomeDir,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialPath: string | null
  onSelectFolder: (absPath: string) => void | Promise<void>
  resolveHomeDir?: () => Promise<string>
}) {
  const [pathInput, setPathInput] = useState("")
  const [cursor, setCursor] = useState(0)
  const [homeDir, setHomeDir] = useState("")
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedValue, setSelectedValue] = useState<string>(COMMAND_NO_SELECTION)
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
      return
    }

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
      setPathInput(initialPath ?? home)
      setCursor((initialPath ?? home).length)
    })()

    return () => {
      cancelled = true
    }
  }, [open, initialPath])

  useEffect(() => {
    if (!open || !completionCtx || !window.jet?.fs) {
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
  }, [open, completionCtx?.parentPath])

  const completions = useMemo(() => {
    if (!completionCtx) return []
    const prefix = completionCtx.partial.toLowerCase()
    return entries.filter(e => e.name.toLowerCase().startsWith(prefix))
  }, [completionCtx, entries])

  useEffect(() => {
    if (completions.length === 0) {
      setSelectedValue(COMMAND_NO_SELECTION)
      return
    }
    const first = completions[0]!.uri
    setSelectedValue(prev => (completions.some(e => e.uri === prev) ? prev : first))
  }, [completions])

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

  const confirmCurrent = useCallback(() => {
    if (!homeDir || !pathInput.trim()) return
    const path = resolvePathForOpen(pathInput, homeDir)
    onOpenChange(false)
    void Promise.resolve(onSelectFolder(path)).catch(err => {
      console.warn("Failed to change directory:", err)
    })
  }, [homeDir, pathInput, onSelectFolder, onOpenChange])

  const moveHighlight = useCallback(
    (delta: 1 | -1) => {
      if (completions.length === 0) return
      const idx = Math.max(
        0,
        completions.findIndex(e => e.uri === selectedValue),
      )
      const next = (idx + delta + completions.length) % completions.length
      setSelectedValue(completions[next]!.uri)
    },
    [completions, selectedValue],
  )

  const highlightedEntry = useMemo(
    () => completions.find(e => e.uri === selectedValue) ?? null,
    [completions, selectedValue],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-lg" showCloseButton={false}>
        <DialogTitle className="sr-only">Change directory</DialogTitle>
        <DialogDescription className="sr-only">Path to folder</DialogDescription>
        <Command
          shouldFilter={false}
          value={selectedValue}
          onValueChange={setSelectedValue}
          className="border-0"
        >
          <CommandInput
            ref={inputRef}
            placeholder="Path to folder…"
            value={pathInput}
            onValueChange={value => {
              setPathInput(value)
              setCursor(value.length)
            }}
            onSelect={syncCursorFromInput}
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
                confirmCurrent()
                return
              }

              if (e.key === "Enter" || e.key === "Tab") {
                if (!highlightedEntry) return
                e.preventDefault()
                applyCompletion(highlightedEntry.name)
              }
            }}
            className="h-12"
            aria-controls="jet-cd-list"
            aria-activedescendant={
              highlightedEntry ? `jet-cd-item-${highlightedEntry.uri}` : undefined
            }
          />
          <CommandList
            id="jet-cd-list"
            className="max-h-[var(--jet-overlay-list-max,20rem)]"
          >
            {error ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">{error}</div>
            ) : !homeDir || loading ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">Loading…</div>
            ) : (
              <>
                <CommandEmpty>No matching directories.</CommandEmpty>
                <CommandItem value={COMMAND_NO_SELECTION} className="hidden" aria-hidden />
                {completions.map(entry => (
                  <CommandItem
                    key={entry.uri}
                    id={`jet-cd-item-${entry.uri}`}
                    value={entry.uri}
                    onSelect={() => applyCompletion(entry.name)}
                    className="gap-2"
                  >
                    <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{entry.name}</span>
                  </CommandItem>
                ))}
              </>
            )}
          </CommandList>
        </Command>
        <div className="border-t p-2">
          <Button
            type="button"
            variant="secondary"
            disabled={!pathInput.trim() || !homeDir}
            onClick={confirmCurrent}
            className="inline-flex w-full items-center justify-center gap-1.5"
          >
            Select folder
            <KeyBindingKbd binding={formatKeyBinding("Mod-Enter")} />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
