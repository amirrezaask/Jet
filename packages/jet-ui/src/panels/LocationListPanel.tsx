import { pathToFileUri } from "@jet/shared"
import type { JetProblem } from "@jet/shared"
import type { LocationItem, LocationListSource, WorkspaceService } from "@jet/workspace"
import { useCallback, useEffect, useRef, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs.js"
import { Input } from "@/components/ui/input.js"
import { Spinner } from "@/components/ui/spinner.js"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.js"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.js"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty.js"
import { ListRow } from "@/components/ListRow.js"
import { SidebarProvider } from "@/components/ui/sidebar.js"
import { registerListPanel } from "@/lib/list-registry.js"
import { CircleAlertIcon } from "lucide-react"

/** Initial virtualizer guess — rows are measured after mount. */
const ROW_HEIGHT_PX = 36

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
  useEffect(() => registerListPanel("locationlist", scrollRef.current), [])
  const rowVirtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 8,
  })

  return (
    <SidebarProvider className="!min-h-0 flex h-full min-h-0 flex-col">
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
        <div className="flex shrink-0 flex-col gap-2 border-b border-border p-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="location-search-input"
              type="search"
              value={state.searchQuery}
              onChange={e => state.setSearchState({ query: e.target.value })}
              placeholder="Search project…"
              className="h-8 min-w-[12rem] flex-1"
              spellCheck={false}
              aria-label="Search project"
            />
            <ToggleGroup
              type="multiple"
              variant="outline"
              size="sm"
              className="shrink-0"
              value={[
                ...(state.searchCaseSensitive ? ["case"] : []),
                ...(state.searchRegex ? ["regex"] : []),
              ]}
              onValueChange={values => {
                state.setSearchState({
                  caseSensitive: values.includes("case"),
                  regex: values.includes("regex"),
                })
              }}
            >
              <ToggleGroupItem value="case" className="h-7 px-2 text-xs">
                Case
              </ToggleGroupItem>
              <ToggleGroupItem value="regex" className="h-7 px-2 text-xs">
                Regex
              </ToggleGroupItem>
            </ToggleGroup>
            {state.searchLoading && (
              <span
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                aria-live="polite"
              >
                <Spinner />
                Searching…
              </span>
            )}
          </div>
          {state.searchError && (
            <Alert variant="destructive" className="py-2">
              <CircleAlertIcon />
              <AlertTitle>Search failed</AlertTitle>
              <AlertDescription>{state.searchError}</AlertDescription>
            </Alert>
          )}
        </div>
      )}
      <ul ref={scrollRef} className="min-h-0 flex-1 overflow-auto p-1">
        {visible.length === 0 ? (
          <li className="p-1">
            <Empty className="border-0 py-4">
              <EmptyHeader>
                <EmptyTitle className="text-sm">No results</EmptyTitle>
                <EmptyDescription className="text-xs">
                  Try another query or switch source tabs.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </li>
        ) : (
          <li style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
            {rowVirtualizer.getVirtualItems().map(virtualRow => {
              const item = visible[virtualRow.index]
              return (
                <div
                  key={item.id}
                  data-index={virtualRow.index}
                  className="overflow-hidden"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: ROW_HEIGHT_PX,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <ListRow
                    data-jet-list-item
                    className="h-full w-full min-w-0 overflow-hidden"
                    style={{ height: ROW_HEIGHT_PX, minHeight: ROW_HEIGHT_PX, maxHeight: ROW_HEIGHT_PX }}
                    onClick={() => onOpenItem(item)}
                  >
                    <span className="truncate text-sm font-medium leading-snug">{item.label}</span>
                    <span className="jet-mono-data truncate text-xs leading-snug text-muted-foreground">
                      {item.path}:{item.line}:{item.column}
                      {item.detail ? ` · ${item.detail}` : ""}
                    </span>
                  </ListRow>
                </div>
              )
            })}
          </li>
        )}
      </ul>
    </div>
    </SidebarProvider>
  )
}

function useStateRev(state: { onDidChange: { event: (fn: () => void) => { dispose: () => void } } }): void {
  const [, setRev] = useState(0)
  useEffect(() => {
    return state.onDidChange.event(() => setRev(r => r + 1)).dispose
  }, [state])
}
