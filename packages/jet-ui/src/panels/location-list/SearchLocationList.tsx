import type { ListDocument, ListItem, WorkspaceService } from "@jet/workspace"
import { useCallback, useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input.js"
import { Spinner } from "@/components/ui/spinner.js"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.js"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.js"
import { CircleAlertIcon } from "lucide-react"
import { LocationList } from "./LocationList.js"
import { useAutoFocus } from "@/lib/use-auto-focus.js"
import { searchHitToListItem } from "./mappers.js"

function useListDocument(doc: ListDocument, workspace: WorkspaceService): ListDocument {
  const [, setRev] = useState(0)
  useEffect(() => {
    return workspace.listStore.onDidChange.event(e => {
      if (e.id === doc.id) setRev(r => r + 1)
    }).dispose
  }, [workspace, doc.id])
  return workspace.listStore.get(doc.id) ?? doc
}

export function SearchLocationList({
  listId,
  workspace,
  onOpenItem,
  autoFocus = false,
}: {
  listId: string
  workspace: WorkspaceService
  onOpenItem: (item: ListItem) => void
  autoFocus?: boolean
}) {
  const initial = workspace.listStore.get(listId)!
  const doc = useListDocument(initial, workspace)
  const searchGen = useRef(0)
  const searchInputRef = useAutoFocus<HTMLInputElement>(autoFocus)

  const patchDoc = useCallback(
    (patch: Partial<ListDocument>) => workspace.listStore.update(listId, patch),
    [workspace, listId],
  )

  const runSearch = useCallback(async () => {
    const query = (doc.searchQuery ?? "").trim()
    if (!workspace.root || !window.jet?.search || !query) {
      searchGen.current += 1
      patchDoc({ searchLoading: false, searchError: null })
      return
    }
    const gen = ++searchGen.current
    patchDoc({ searchLoading: true, searchError: null })
    try {
      const hits = await window.jet.search.project(workspace.root.uri, query, {
        caseSensitive: doc.searchCaseSensitive ?? false,
        regex: doc.searchRegex ?? false,
        fuzzy: doc.searchFuzzy ?? false,
      })
      if (gen !== searchGen.current) return
      const items = hits.map((h, i) =>
        searchHitToListItem(h, i, workspace.root!.path),
      )
      patchDoc({ items, searchLoading: false })
    } catch (err) {
      if (gen !== searchGen.current) return
      patchDoc({
        searchLoading: false,
        searchError: err instanceof Error ? err.message : String(err),
      })
    }
  }, [workspace, doc, patchDoc])

  useEffect(() => {
    const id = window.setTimeout(() => void runSearch(), 300)
    return () => window.clearTimeout(id)
  }, [
    runSearch,
    doc.searchQuery,
    doc.searchCaseSensitive,
    doc.searchRegex,
    doc.searchFuzzy,
  ])

  const header = (
    <div className="flex shrink-0 flex-col gap-2 border-b border-border p-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={`search-input-${listId}`}
          ref={searchInputRef}
          type="search"
          value={doc.searchQuery ?? ""}
          onChange={e => patchDoc({ searchQuery: e.target.value })}
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
            ...(doc.searchCaseSensitive ? ["case"] : []),
            ...(doc.searchRegex && !doc.searchFuzzy ? ["regex"] : []),
            ...(doc.searchFuzzy ? ["fuzzy"] : []),
          ]}
          onValueChange={values => {
            const fuzzy = values.includes("fuzzy")
            patchDoc({
              searchCaseSensitive: values.includes("case"),
              searchRegex: fuzzy ? false : values.includes("regex"),
              searchFuzzy: fuzzy,
            })
          }}
        >
          <ToggleGroupItem value="case" className="h-7 px-2 text-xs">
            Case
          </ToggleGroupItem>
          <ToggleGroupItem
            value="regex"
            className="h-7 px-2 text-xs"
            disabled={doc.searchFuzzy}
          >
            Regex
          </ToggleGroupItem>
          <ToggleGroupItem value="fuzzy" className="h-7 px-2 text-xs">
            Fuzzy
          </ToggleGroupItem>
        </ToggleGroup>
        {doc.searchLoading && (
          <span
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
            aria-live="polite"
          >
            <Spinner />
            Searching…
          </span>
        )}
      </div>
      {doc.searchError && (
        <Alert variant="destructive" className="py-2">
          <CircleAlertIcon />
          <AlertTitle>Search failed</AlertTitle>
          <AlertDescription>{doc.searchError}</AlertDescription>
        </Alert>
      )}
    </div>
  )

  return (
    <LocationList
      listId={listId}
      items={doc.items}
      onOpenItem={onOpenItem}
      loading={doc.searchLoading}
      emptyTitle="No results"
      emptyDescription="Try another query."
      header={header}
    />
  )
}
