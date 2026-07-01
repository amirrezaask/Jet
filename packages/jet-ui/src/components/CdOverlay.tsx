import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { Folder } from "lucide-react"
import { pathToFileUri } from "@jet/shared"
import {
  applyPathCompletion,
  deletePathSegmentBackward,
  parsePathCompletionContext,
  resolvePathForOpen,
} from "@jet/workspace"
import { JetOverlay } from "./JetOverlay.js"

type DirEntry = {
  uri: string
  name: string
}

const MAX_DIR_ENTRIES = 500

function listNavModifiers(e: KeyboardEvent): boolean {
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
  const [highlight, setHighlight] = useState(0)
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
      setHighlight(0)
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
        setHighlight(0)
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
    if (highlight >= completions.length) setHighlight(Math.max(0, completions.length - 1))
  }, [highlight, completions.length])

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

  if (!open) return null

  return (
    <JetOverlay open={open} onOpenChange={onOpenChange} ariaLabel="Change directory" maxWidth="36rem">
      <div className="overflow-hidden rounded-md border border-[var(--jet-border)] bg-[var(--jet-panel-raised)] shadow-2xl">
        <input
          ref={inputRef}
          placeholder="Path to folder…"
          value={pathInput}
          onChange={e => {
            setPathInput(e.target.value)
            setCursor(e.target.selectionStart ?? e.target.value.length)
            setHighlight(0)
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

            if (e.key === "ArrowDown" && !listNavModifiers(e)) {
              e.preventDefault()
              setHighlight(i => Math.min(i + 1, Math.max(0, completions.length - 1)))
              return
            }
            if (e.key === "ArrowUp" && !listNavModifiers(e)) {
              e.preventDefault()
              setHighlight(i => Math.max(i - 1, 0))
              return
            }

            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              confirmCurrent()
              return
            }

            if (e.key === "Enter" || e.key === "Tab") {
              const entry = completions[highlight]
              if (!entry) return
              e.preventDefault()
              applyCompletion(entry.name)
            }
          }}
          className="jet-input w-full border-b border-[var(--jet-border)] bg-transparent px-3 py-2 text-[length:var(--jet-fs-base)]"
          autoFocus
        />
        <div className="overflow-auto p-1" style={{ maxHeight: "20rem" }}>
          {error ? (
            <div className="px-3 py-2 text-[length:var(--jet-fs-base)] text-[var(--jet-text-muted)]">{error}</div>
          ) : null}
          {!homeDir || loading ? (
            <div className="px-3 py-2 text-[length:var(--jet-fs-base)] text-[var(--jet-text-muted)]">Loading…</div>
          ) : completions.length === 0 ? (
            <div className="px-3 py-2 text-[length:var(--jet-fs-base)] text-[var(--jet-text-muted)]">No matching directories.</div>
          ) : (
            completions.map((entry, index) => (
              <button
                key={entry.uri}
                type="button"
                onMouseEnter={() => setHighlight(index)}
                onClick={() => applyCompletion(entry.name)}
                className={`flex w-full cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-left text-[length:var(--jet-fs-base)] ${
                  index === highlight ? "bg-[var(--jet-hover)]" : ""
                }`}
              >
                <Folder className="size-3.5 shrink-0 text-[var(--jet-accent)]" />
                <span className="flex-1 truncate">{entry.name}</span>
              </button>
            ))
          )}
        </div>
        <div className="border-t border-[var(--jet-border)] px-3 py-2">
          <button
            type="button"
            disabled={!pathInput.trim() || !homeDir}
            onClick={confirmCurrent}
            className="w-full cursor-pointer rounded-sm px-2 py-1.5 text-left text-[length:var(--jet-fs-xs)] text-[var(--jet-text-muted)] hover:bg-[var(--jet-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Select folder (⌘↵)
          </button>
        </div>
      </div>
    </JetOverlay>
  )
}
