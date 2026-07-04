import { pathToFileUri } from "@jet/shared"
import type { JetProblem } from "@jet/shared"
import type { LocationItem, LocationListSource, WorkspaceService } from "@jet/workspace"
import { useCallback, useEffect, useRef, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { cn } from "../lib/utils.js"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.js"
import { Input } from "@/components/ui/input.js"
import { Checkbox } from "@/components/ui/checkbox.js"
import { Label } from "@/components/ui/label.js"

const ROW_HEIGHT_PX = 44

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
  const scrollRef = useRef<HTMLUListElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 8,
  })

  return (
    <div className="flex h-full min-h-0 flex-col" data-jet-list-panel="locationlist">
      <Tabs
        value={state.activeSource}
        onValueChange={v => state.setSource(v as LocationListSource)}
        className="shrink-0 border-b border-border p-1"
      >
        <TabsList className="h-7 w-full justify-start bg-transparent p-0">
          {sources.map(s => (
            <TabsTrigger key={s.id} value={s.id} className="h-6 px-2 text-xs">
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {state.activeSource === "search" && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border p-2">
          <Input
            type="search"
            value={state.searchQuery}
            onChange={e => state.setSearchState({ query: e.target.value })}
            placeholder="Search project…"
            className="min-w-[12rem] flex-1 h-8"
          />
          <div className="flex items-center gap-1">
            <Checkbox
              id="search-case"
              checked={state.searchCaseSensitive}
              onCheckedChange={checked =>
                state.setSearchState({ caseSensitive: checked === true })
              }
            />
            <Label htmlFor="search-case" className="text-xs">
              Case
            </Label>
          </div>
          <div className="flex items-center gap-1">
            <Checkbox
              id="search-regex"
              checked={state.searchRegex}
              onCheckedChange={checked => state.setSearchState({ regex: checked === true })}
            />
            <Label htmlFor="search-regex" className="text-xs">
              Regex
            </Label>
          </div>
          {state.searchLoading && (
            <span className="text-xs text-muted-foreground">Searching…</span>
          )}
          {state.searchError && (
            <span className="text-xs text-destructive">{state.searchError}</span>
          )}
        </div>
      )}
      <ul ref={scrollRef} className="min-h-0 flex-1 overflow-auto p-1">
        {visible.length === 0 ? (
          <li className="p-2 text-xs text-muted-foreground">No results</li>
        ) : (
          <li style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
            {rowVirtualizer.getVirtualItems().map(virtualRow => {
              const item = visible[virtualRow.index]
              return (
                <div
                  key={item.id}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <button
                    type="button"
                    data-jet-list-item
                    className="flex w-full flex-col rounded px-2 py-1 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none"
                    onClick={() => onOpenItem(item)}
                  >
                    <span className="truncate font-medium">{item.label}</span>
                    <span className="jet-mono-data truncate text-xs text-muted-foreground">
                      {item.path}:{item.line}:{item.column}
                      {item.detail ? ` · ${item.detail}` : ""}
                    </span>
                  </button>
                </div>
              )
            })}
          </li>
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
