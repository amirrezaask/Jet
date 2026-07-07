import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import { Spinner } from "@/components/ui/spinner.js"
import { PaletteShell, type PaletteShellItem } from "./palette/PaletteShell.js"

export function QuickOpenOverlay({
  open,
  onOpenChange,
  onSearch,
  scanReady = true,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSearch: (query: string) => Promise<string[]>
  scanReady?: boolean
  onSelect: (path: string, query: string) => void
}) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<string[]>([])
  const [searching, setSearching] = useState(false)
  const deferredQuery = useDeferredValue(query)
  const searchGen = useRef(0)

  useEffect(() => {
    if (!open) {
      setQuery("")
      setResults([])
      setSearching(false)
    }
  }, [open])

  useEffect(() => {
    if (!open || !scanReady) {
      setResults([])
      return
    }

    const gen = ++searchGen.current
    const id = window.setTimeout(() => {
      setSearching(true)
      void onSearch(deferredQuery)
        .then(paths => {
          if (gen !== searchGen.current) return
          setResults(paths)
          setSearching(false)
        })
        .catch(() => {
          if (gen !== searchGen.current) return
          setResults([])
          setSearching(false)
        })
    }, 80)

    return () => window.clearTimeout(id)
  }, [open, scanReady, deferredQuery, onSearch])

  const items = useMemo<PaletteShellItem<string>[]>(
    () => results.map(path => ({ key: path, value: path, data: path })),
    [results],
  )

  const statusRow = !scanReady ? (
    <div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
      <Spinner />
      Indexing workspace…
    </div>
  ) : searching ? (
    <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
      <Spinner />
      Searching…
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
      onSelect={path => onSelect(path, query)}
      emptyLabel={scanReady ? "No matching files." : "Waiting for index…"}
      statusRow={statusRow}
      renderItem={path => <span className="font-mono">{path}</span>}
    />
  )
}
