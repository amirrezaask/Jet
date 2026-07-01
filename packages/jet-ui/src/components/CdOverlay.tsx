import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronRight, Folder, FolderUp } from "lucide-react"
import { pathToFileUri } from "@jet/shared"
import { JetOverlay } from "./JetOverlay.js"

type DirEntry = {
  uri: string
  name: string
}

const MAX_DIR_ENTRIES = 500

function parentDir(absPath: string): string | null {
  const normalized = absPath.replace(/[/\\]+$/, "")
  const idx = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"))
  if (idx <= 0) return null
  return normalized.slice(0, idx) || "/"
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
  const [currentPath, setCurrentPath] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [highlight, setHighlight] = useState(0)
  const resolveHomeDirRef = useRef(resolveHomeDir)
  resolveHomeDirRef.current = resolveHomeDir

  useEffect(() => {
    if (!open) {
      setCurrentPath(null)
      setQuery("")
      setEntries([])
      setError(null)
      setLoading(false)
      setHighlight(0)
      return
    }

    let cancelled = false
    void (async () => {
      if (initialPath) {
        if (!cancelled) setCurrentPath(initialPath)
        return
      }
      const resolve = resolveHomeDirRef.current
      if (!resolve) return
      try {
        const home = await resolve()
        if (!cancelled) setCurrentPath(home)
      } catch {
        if (!cancelled) setError("Could not resolve a starting directory.")
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, initialPath])

  useEffect(() => {
    if (!open || !currentPath || !window.jet?.fs) {
      setEntries([])
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    void window.jet.fs
      .readDir(pathToFileUri(currentPath))
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
  }, [open, currentPath])

  const goUp = useCallback(() => {
    if (!currentPath) return
    const parent = parentDir(currentPath)
    if (parent) {
      setCurrentPath(parent)
      setQuery("")
    }
  }, [currentPath])

  const enterDir = useCallback(
    (name: string) => {
      if (!currentPath) return
      const sep = currentPath.includes("\\") ? "\\" : "/"
      setCurrentPath(`${currentPath}${sep}${name}`)
      setQuery("")
    },
    [currentPath],
  )

  const confirmCurrent = useCallback(() => {
    if (!currentPath) return
    const path = currentPath
    onOpenChange(false)
    void Promise.resolve(onSelectFolder(path)).catch(err => {
      console.warn("Failed to change directory:", err)
    })
  }, [currentPath, onSelectFolder, onOpenChange])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(e => e.name.toLowerCase().includes(q))
  }, [entries, query])

  const canGoUp = currentPath != null && parentDir(currentPath) != null
  const rows = useMemo(() => {
    const list: { key: string; label: string; action: () => void }[] = []
    if (canGoUp) list.push({ key: "__parent__", label: "..", action: goUp })
    for (const entry of filtered) {
      list.push({
        key: entry.uri,
        label: entry.name,
        action: () => enterDir(entry.name),
      })
    }
    return list
  }, [canGoUp, filtered, goUp, enterDir])

  useEffect(() => {
    if (highlight >= rows.length) setHighlight(Math.max(0, rows.length - 1))
  }, [highlight, rows.length])

  if (!open) return null

  return (
    <JetOverlay open={open} onOpenChange={onOpenChange} ariaLabel="Change directory" maxWidth="36rem">
      <div className="overflow-hidden rounded-md border border-[var(--jet-border)] bg-[var(--jet-panel-raised)] shadow-2xl">
        <div className="border-b border-[var(--jet-border)] px-3 py-1.5 text-[length:var(--jet-fs-xs)] text-[var(--jet-text-muted)]">
          {currentPath ?? "…"}
        </div>
        <input
          placeholder="Filter directories…"
          value={query}
          onChange={e => {
            setQuery(e.target.value)
            setHighlight(0)
          }}
          onKeyDown={e => {
            if (e.key === "ArrowDown") {
              e.preventDefault()
              setHighlight(i => Math.min(i + 1, Math.max(0, rows.length - 1)))
              return
            }
            if (e.key === "ArrowUp") {
              e.preventDefault()
              setHighlight(i => Math.max(i - 1, 0))
              return
            }
            if (e.key === "Backspace" && query === "" && canGoUp) {
              e.preventDefault()
              goUp()
              return
            }
            if (e.key === "Enter") {
              e.preventDefault()
              if (e.metaKey || e.ctrlKey) {
                confirmCurrent()
                return
              }
              const row = rows[highlight]
              if (row) row.action()
              else confirmCurrent()
            }
          }}
          className="jet-input w-full border-b border-[var(--jet-border)] bg-transparent px-3 py-2 text-[length:var(--jet-fs-base)]"
          autoFocus
        />
        <div className="overflow-auto p-1" style={{ maxHeight: "20rem" }}>
          {error ? (
            <div className="px-3 py-2 text-[length:var(--jet-fs-base)] text-[var(--jet-text-muted)]">{error}</div>
          ) : null}
          {!currentPath || loading ? (
            <div className="px-3 py-2 text-[length:var(--jet-fs-base)] text-[var(--jet-text-muted)]">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="px-3 py-2 text-[length:var(--jet-fs-base)] text-[var(--jet-text-muted)]">No matching directories.</div>
          ) : (
            rows.map((row, index) => (
              <button
                key={row.key}
                type="button"
                onMouseEnter={() => setHighlight(index)}
                onClick={() => row.action()}
                className={`flex w-full cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-left text-[length:var(--jet-fs-base)] ${
                  index === highlight ? "bg-[var(--jet-hover)]" : ""
                }`}
              >
                {row.label === ".." ? (
                  <FolderUp className="size-3.5 shrink-0 text-[var(--jet-text-muted)]" />
                ) : (
                  <Folder className="size-3.5 shrink-0 text-[var(--jet-accent)]" />
                )}
                <span className="flex-1 truncate">{row.label}</span>
                {row.label !== ".." ? (
                  <ChevronRight className="size-3 shrink-0 text-[var(--jet-text-muted)]" />
                ) : null}
              </button>
            ))
          )}
        </div>
        <div className="border-t border-[var(--jet-border)] px-3 py-2">
          <button
            type="button"
            disabled={!currentPath}
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
