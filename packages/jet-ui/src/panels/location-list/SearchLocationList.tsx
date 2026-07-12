import type { ListDocument, ListItem, WorkspaceFolder, WorkspaceService } from "@jet/workspace"
import { projectSearchAcrossFolders } from "@jet/workspace"
import { useCallback, useEffect, useRef, useState } from "react"
import { JetCaretInput } from "@/motion/useJetCaretOverlay.js"
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
  getSearchFolders,
  autoFocus = false,
}: {
  listId: string
  workspace: WorkspaceService
  onOpenItem: (item: ListItem) => void
  /** When set, project search is scoped to these folders (e.g. current tab workspace). */
  getSearchFolders?: () => WorkspaceFolder[]
  autoFocus?: boolean
}) {
  const initial = workspace.listStore.get(listId)!
  const doc = useListDocument(initial, workspace)
  const searchGen = useRef(0)
  const searchQueue = useRef(Promise.resolve())
  const searchInputRef = useAutoFocus<HTMLInputElement>(autoFocus)

  const patchDoc = useCallback(
    (patch: Partial<ListDocument>) => workspace.listStore.update(listId, patch),
    [workspace, listId],
  )

  const runSearch = useCallback(async () => {
    const current = workspace.listStore.get(listId)
    if (!current) return
    const query = (current.searchQuery ?? "").trim()
    const folders = getSearchFolders?.() ?? workspace.folders
    if (folders.length === 0 || !window.jet?.search || !query) {
      searchGen.current += 1
      patchDoc({ searchLoading: false, searchError: null })
      return
    }
    const gen = ++searchGen.current
    patchDoc({ searchLoading: true, searchError: null })
    searchQueue.current = searchQueue.current
      .catch(() => undefined)
      .then(async () => {
        if (gen !== searchGen.current) return
        try {
          const hits = await projectSearchAcrossFolders(folders, window.jet!.search!, query, {
            caseSensitive: current.searchCaseSensitive ?? false,
            regex: current.searchRegex ?? false,
            fuzzy: current.searchFuzzy ?? false,
          })
          if (gen !== searchGen.current) return
          const multiRoot = folders.length > 1
          const items = hits.map((h, i) =>
            searchHitToListItem(
              h.result,
              i,
              h.folder.root.path,
              multiRoot ? h.folder.root.name : undefined,
            ),
          )
          patchDoc({ items, searchLoading: false })
        } catch (err) {
          if (gen !== searchGen.current) return
          patchDoc({
            searchLoading: false,
            searchError: err instanceof Error ? err.message : String(err),
          })
        }
      })
    await searchQueue.current
  }, [workspace, listId, patchDoc, getSearchFolders])
  const runSearchRef = useRef(runSearch)
  runSearchRef.current = runSearch

  useEffect(() => {
    void runSearchRef.current()
  }, [
    doc.searchQuery,
    doc.searchCaseSensitive,
    doc.searchRegex,
    doc.searchFuzzy,
  ])

  const header = (
    <div className="flex shrink-0 flex-col gap-2 border-b border-border p-2">
      <div className="flex flex-wrap items-center gap-2">
        <JetCaretInput
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
      showInput
      filterPlaceholder="Filter results…"
    />
  )
}
