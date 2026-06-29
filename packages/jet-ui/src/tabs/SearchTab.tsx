import { useCallback, useEffect, useRef, useState } from "react"
import type { ProjectSearchResult } from "@jet/shared"
import type { WorkspaceService } from "@jet/workspace"
import { cn } from "../lib/utils.js"

export function SearchTab({
  workspace,
  onOpenResult,
  onFindInEditor,
}: {
  workspace: WorkspaceService
  onOpenResult: (path: string, line: number, column: number) => void
  onFindInEditor: () => void
}) {
  const [query, setQuery] = useState("")
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [regex, setRegex] = useState(false)
  const [results, setResults] = useState<ProjectSearchResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const searchGen = useRef(0)

  const runSearch = useCallback(async () => {
    if (!workspace.root || !window.jet?.search || !query.trim()) {
      searchGen.current += 1
      setResults([])
      setError(null)
      setLoading(false)
      return
    }
    const gen = ++searchGen.current
    setLoading(true)
    setError(null)
    try {
      const hits = await window.jet.search.project(workspace.root.uri, query, {
        caseSensitive,
        regex,
      })
      if (gen !== searchGen.current) return
      setResults(hits)
    } catch (err) {
      if (gen !== searchGen.current) return
      setError(err instanceof Error ? err.message : String(err))
      setResults([])
    } finally {
      if (gen === searchGen.current) setLoading(false)
    }
  }, [workspace, query, caseSensitive, regex])

  useEffect(() => {
    const id = window.setTimeout(() => void runSearch(), 300)
    return () => window.clearTimeout(id)
  }, [runSearch])

  const grouped = groupByFile(results)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--jet-border)] p-2">
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search project…"
          className="jet-input min-w-[12rem] flex-1 rounded-sm border border-[var(--jet-border)] bg-transparent px-2 py-1 text-sm"
        />
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={e => setCaseSensitive(e.target.checked)}
          />
          Case
        </label>
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={regex} onChange={e => setRegex(e.target.checked)} />
          Regex
        </label>
        <button
          type="button"
          className="text-xs text-[var(--jet-accent)]"
          onClick={onFindInEditor}
        >
          Find in editor
        </button>
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto p-2 text-sm"
        aria-label="Search"
        data-jet-list-panel="search"
        tabIndex={-1}
      >
        {loading && <p className="text-[var(--jet-text-muted)]">Searching…</p>}
        {error && <p className="text-[var(--jet-error)]">{error}</p>}
        {!loading && !error && results.length === 0 && query.trim() && (
          <p className="text-[var(--jet-text-muted)]">No results.</p>
        )}
        {Object.entries(grouped).map(([file, hits]) => (
          <div key={file} className="mb-3">
            <div className="mb-1 font-mono text-xs text-[var(--jet-accent)]">{file}</div>
            {hits.map((hit, i) => (
              <button
                key={`${hit.line}-${hit.column}-${i}`}
                type="button"
                onClick={() => onOpenResult(hit.path, hit.line, hit.column)}
                className={cn(
                  "jet-list-item flex w-full gap-2 rounded-sm px-2 py-1 text-left text-xs hover:bg-[var(--jet-hover)]",
                )}
                data-jet-list-item
              >
                <span className="shrink-0 tabular-nums text-[var(--jet-text-muted)]">
                  {hit.line}:{hit.column}
                </span>
                <span className="truncate font-mono">{hit.preview}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function groupByFile(results: ProjectSearchResult[]): Record<string, ProjectSearchResult[]> {
  const map: Record<string, ProjectSearchResult[]> = {}
  for (const r of results) {
    ;(map[r.path] ??= []).push(r)
  }
  return map
}
