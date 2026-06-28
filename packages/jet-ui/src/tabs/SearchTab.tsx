import { useCallback, useEffect, useState } from "react"
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

  const runSearch = useCallback(async () => {
    if (!workspace.root || !window.jet?.search || !query.trim()) {
      setResults([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const hits = await window.jet.search.project(workspace.root.uri, query, {
        caseSensitive,
        regex,
      })
      setResults(hits)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setResults([])
    } finally {
      setLoading(false)
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
          className="min-w-[12rem] flex-1 rounded border border-[var(--jet-border)] bg-transparent px-2 py-1 text-sm outline-none"
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
      <div className="min-h-0 flex-1 overflow-auto p-2 text-sm">
        {loading && <p className="text-[var(--jet-text-muted)]">Searching…</p>}
        {error && <p className="text-red-400">{error}</p>}
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
                  "flex w-full gap-2 rounded px-2 py-1 text-left text-xs hover:bg-[var(--jet-hover)]",
                )}
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
