import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import { Spinner } from "@/components/ui/spinner.js"
import { Button } from "@/components/ui/button.js"
import { FileIcon } from "@/lib/file-icon.js"
import { cn } from "@/lib/utils.js"
import { PaletteShell, type PaletteShellItem } from "./palette/PaletteShell.js"

export type QuickOpenWorkspace = {
  id: string
  name: string
}

export function QuickOpenOverlay({
  open,
  onOpenChange,
  onSearch,
  scanReady = true,
  workspaces = [],
  defaultWorkspaceId = null,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSearch: (query: string, workspaceId: string | null) => Promise<string[]>
  scanReady?: boolean
  workspaces?: QuickOpenWorkspace[]
  defaultWorkspaceId?: string | null
  onSelect: (path: string, query: string, workspaceId: string | null) => void
}) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<string[]>([])
  const [searching, setSearching] = useState(false)
  const [workspaceId, setWorkspaceId] = useState<string | null>(defaultWorkspaceId)
  const deferredQuery = useDeferredValue(query)
  const searchGen = useRef(0)

  useEffect(() => {
    if (!open) {
      setQuery("")
      setResults([])
      setSearching(false)
      setWorkspaceId(defaultWorkspaceId)
    }
  }, [open, defaultWorkspaceId])

  useEffect(() => {
    if (!open || !scanReady) {
      setResults([])
      return
    }

    const gen = ++searchGen.current
    let spinnerId: number | undefined
    const run = () => {
      spinnerId = window.setTimeout(() => {
        if (gen === searchGen.current) setSearching(true)
      }, 60)
      void onSearch(deferredQuery, workspaceId)
        .then(paths => {
          if (spinnerId !== undefined) window.clearTimeout(spinnerId)
          if (gen !== searchGen.current) return
          setResults(paths)
          setSearching(false)
        })
        .catch(() => {
          if (spinnerId !== undefined) window.clearTimeout(spinnerId)
          if (gen !== searchGen.current) return
          setResults([])
          setSearching(false)
        })
    }

    if (deferredQuery === "") {
      run()
      return () => {
        if (spinnerId !== undefined) window.clearTimeout(spinnerId)
      }
    }

    const id = window.setTimeout(run, 80)
    return () => {
      window.clearTimeout(id)
      if (spinnerId !== undefined) window.clearTimeout(spinnerId)
    }
  }, [open, scanReady, deferredQuery, onSearch, workspaceId])

  const items = useMemo<PaletteShellItem<string>[]>(
    () => results.map(path => ({ key: path, value: path, data: path })),
    [results],
  )

  const statusRow = workspaces.length > 1 || !scanReady || searching ? (
    <div className="flex min-h-9 items-center justify-between gap-2 border-b px-2 py-1 text-xs text-muted-foreground">
      {workspaces.length > 1 ? (
        <div
          role="group"
          aria-label="Filter files by workspace"
          className="flex min-w-0 items-center gap-0.5 overflow-x-auto"
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn("h-7 shrink-0 px-2 text-xs", workspaceId === null && "bg-accent text-accent-foreground")}
            aria-pressed={workspaceId === null}
            onClick={() => setWorkspaceId(null)}
          >
            All
          </Button>
          {workspaces.map(workspace => (
            <Button
              key={workspace.id}
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 max-w-[11rem] shrink-0 px-2 text-xs",
                workspaceId === workspace.id && "bg-accent text-accent-foreground",
              )}
              aria-pressed={workspaceId === workspace.id}
              aria-label={`Only ${workspace.name}`}
              onClick={() => setWorkspaceId(workspace.id)}
            >
              <span className="truncate">{workspace.name}</span>
            </Button>
          ))}
        </div>
      ) : <span />}
      {!scanReady ? (
        <span className="flex items-center gap-2 px-1"><Spinner />Indexing workspace…</span>
      ) : searching ? (
        <span className="flex items-center gap-2 px-1"><Spinner />Searching…</span>
      ) : null}
    </div>
  ) : undefined

  return (
    <PaletteShell
      open={open}
      onOpenChange={onOpenChange}
      title="Quick open"
      description="Type a file name…"
      placeholder={scanReady ? "Type a file name…" : "Indexing workspace…"}
      disabled={!scanReady}
      query={query}
      onQueryChange={setQuery}
      items={items}
      shouldFilter={false}
      onSelect={path => onSelect(path, query, workspaceId)}
      emptyLabel={scanReady ? "No matching files." : "Waiting for index…"}
      statusRow={statusRow}
      renderItem={path => (
        <>
          <FileIcon path={path} />
          <span className="truncate font-mono">{path}</span>
        </>
      )}
    />
  )
}
