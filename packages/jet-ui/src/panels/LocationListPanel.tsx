import { pathToFileUri } from "@jet/shared"
import type { JetProblem } from "@jet/shared"
import type { LocationItem, LocationListSource, WorkspaceService } from "@jet/workspace"
import { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "../lib/utils.js"

export function problemsToLocationItems(problems: JetProblem[]): LocationItem[] {
  return problems.map((p, i) => ({
    id: `problem-${i}-${p.uri}-${p.line}`,
    fileUri: p.uri,
    path: p.uri.replace(/^file:\/\//, ""),
    line: p.line,
    column: p.column,
    label: p.message,
    detail: p.severity,
    source: "problems" as const,
  }))
}

export function LocationListPanel({
  workspace,
  onOpenItem,
}: {
  workspace: WorkspaceService
  onOpenItem: (item: LocationItem) => void
}) {
  const state = workspace.locationList
  useStateRev(state)
  const searchGen = useRef(0)

  const runSearch = useCallback(async () => {
    const query = state.searchQuery.trim()
    if (!workspace.root || !window.jet?.search || !query) {
      searchGen.current += 1
      state.setSearchState({ loading: false, error: null })
      return
    }
    const gen = ++searchGen.current
    state.setSearchState({ loading: true, error: null })
    try {
      const hits = await window.jet.search.project(workspace.root.uri, query, {
        caseSensitive: state.searchCaseSensitive,
        regex: state.searchRegex,
      })
      if (gen !== searchGen.current) return
      const items: LocationItem[] = hits.map((h, i) => ({
        id: `search-${i}-${h.path}-${h.line}`,
        fileUri: pathToFileUri(`${workspace.root!.path}/${h.path.replace(/^\/+/, "")}`),
        path: h.path,
        line: h.line,
        column: h.column,
        label: h.preview.trim() || h.path,
        source: "search",
      }))
      const other = state.items.filter(i => i.source !== "search")
      state.setItems([...other, ...items], "search")
      state.setSearchState({ loading: false })
    } catch (err) {
      if (gen !== searchGen.current) return
      state.setSearchState({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }, [workspace, state])

  useEffect(() => {
    if (state.activeSource !== "search") return
    const id = window.setTimeout(() => void runSearch(), 300)
    return () => window.clearTimeout(id)
  }, [runSearch, state.activeSource, state.searchQuery, state.searchCaseSensitive, state.searchRegex])

  const sources: { id: LocationListSource; label: string }[] = [
    { id: "search", label: "Search" },
    { id: "problems", label: "Problems" },
    { id: "references", label: "Refs" },
    { id: "definitions", label: "Defs" },
    { id: "task-errors", label: "Tasks" },
  ]

  const visible = state.itemsForActiveSource()

  return (
    <div className="flex h-full min-h-0 flex-col" data-jet-list-panel="locationlist">
      <div className="flex shrink-0 gap-1 border-b border-[var(--jet-border)] p-1">
        {sources.map(s => (
          <button
            key={s.id}
            type="button"
            className={cn(
              "rounded px-2 py-0.5 text-[length:var(--jet-fs-xs)] uppercase tracking-wide",
              state.activeSource === s.id
                ? "bg-[var(--jet-accent)] text-[var(--jet-bg)]"
                : "text-[var(--jet-text-muted)] hover:text-[var(--jet-text)]",
            )}
            onClick={() => state.setSource(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
      {state.activeSource === "search" && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--jet-border)] p-2">
          <input
            type="search"
            value={state.searchQuery}
            onChange={e => state.setSearchState({ query: e.target.value })}
            placeholder="Search project…"
            className="jet-input min-w-[12rem] flex-1 rounded-sm border border-[var(--jet-border)] bg-transparent px-2 py-1 text-[length:var(--jet-fs-sm)]"
          />
          <label className="flex items-center gap-1 text-[length:var(--jet-fs-xs)]">
            <input
              type="checkbox"
              checked={state.searchCaseSensitive}
              onChange={e => state.setSearchState({ caseSensitive: e.target.checked })}
            />
            Case
          </label>
          <label className="flex items-center gap-1 text-[length:var(--jet-fs-xs)]">
            <input
              type="checkbox"
              checked={state.searchRegex}
              onChange={e => state.setSearchState({ regex: e.target.checked })}
            />
            Regex
          </label>
          {state.searchLoading && (
            <span className="text-[length:var(--jet-fs-xs)] text-[var(--jet-text-muted)]">Searching…</span>
          )}
          {state.searchError && (
            <span className="text-[length:var(--jet-fs-xs)] text-[var(--jet-error)]">{state.searchError}</span>
          )}
        </div>
      )}
      <ul className="min-h-0 flex-1 overflow-auto p-1">
        {visible.length === 0 ? (
          <li className="p-2 text-[length:var(--jet-fs-xs)] text-[var(--jet-text-muted)]">No results</li>
        ) : (
          visible.map(item => (
            <li key={item.id}>
              <button
                type="button"
                data-jet-list-item
                className="flex w-full flex-col rounded px-2 py-1 text-left text-[length:var(--jet-fs-sm)] hover:bg-[var(--jet-border)]/40 focus:bg-[var(--jet-border)]/60 focus:outline-none"
                onClick={() => onOpenItem(item)}
              >
                <span className="truncate font-medium">{item.label}</span>
                <span className="jet-mono-data truncate text-[length:var(--jet-fs-xs)] text-[var(--jet-text-muted)]">
                  {item.path}:{item.line}:{item.column}
                  {item.detail ? ` · ${item.detail}` : ""}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}

function useStateRev(state: { onDidChange: { event: (fn: () => void) => { dispose: () => void } } }): void {
  const [, setRev] = useState(0)
  useEffect(() => {
    return state.onDidChange.event(() => setRev(r => r + 1)).dispose
  }, [state])
}
