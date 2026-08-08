import type { ListDocument, ListItem, WorkspaceFolder, WorkspaceService } from "@yaade/workspace"
import { projectSearchPageAcrossFolders } from "@yaade/workspace"
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Input } from "@/components/ui/input.js"
import { Spinner } from "@/components/ui/spinner.js"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.js"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert.js"
import { CircleAlertIcon } from "lucide-react"
import { LocationList } from "./LocationList.js"
import { useAutoFocus } from "@/lib/use-auto-focus.js"
import { searchHitToListItem } from "./mappers.js"
import { focusListPanel } from "@/lib/list-registry.js"

function parseGlobs(value: string | undefined): string[] | undefined {
  const globs = (value ?? "").split(",").map(item => item.trim()).filter(Boolean)
  return globs.length > 0 ? globs : undefined
}

function useListDocument(doc: ListDocument, workspace: WorkspaceService): ListDocument {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const disposable = workspace.listStore.onDidChange.event(event => {
        if (event.id === doc.id) onStoreChange()
      })
      return () => disposable.dispose()
    },
    [doc.id, workspace],
  )
  const getSnapshot = useCallback(
    () => workspace.listStore.get(doc.id) ?? doc,
    [doc, workspace],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function SearchLocationList({
  listId,
  workspace,
  onOpenItem,
  getSearchFolders,
  autoFocus = false,
  onDismiss,
}: {
  listId: string
  workspace: WorkspaceService
  onOpenItem: (item: ListItem) => void
  /** When set, project search is scoped to these folders (e.g. current tab workspace). */
  getSearchFolders?: () => WorkspaceFolder[]
  autoFocus?: boolean
  onDismiss?: () => void
}) {
  const initial = workspace.listStore.get(listId)!
  const doc = useListDocument(initial, workspace)
  const searchGen = useRef(0)
  const autoFocusInputRef = useAutoFocus<HTMLInputElement>(autoFocus)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!autoFocus) return
    let secondFrame = 0
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        searchInputRef.current?.focus()
      })
    })
    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame) window.cancelAnimationFrame(secondFrame)
    }
  }, [autoFocus])

  const patchDoc = useCallback(
    (patch: Partial<ListDocument>) => workspace.listStore.update(listId, patch),
    [workspace, listId],
  )

  const runSearch = useCallback(async (signal: AbortSignal) => {
    const current = workspace.listStore.get(listId)
    if (!current) return
    const query = (current.searchQuery ?? "").trim()
    const folders = getSearchFolders?.() ?? workspace.folders
    if (folders.length === 0 || !window.yaade?.search || !query) {
      searchGen.current += 1
      patchDoc({
        items: [],
        searchLoading: false,
        searchError: null,
        searchTruncated: false,
      })
      return
    }
    const gen = ++searchGen.current
    patchDoc({ searchLoading: true, searchError: null })
    try {
      const page = await projectSearchPageAcrossFolders(folders, window.yaade.search, query, {
        caseSensitive: current.searchCaseSensitive ?? false,
        regex: current.searchRegex ?? false,
        fuzzy: current.searchFuzzy ?? false,
        wholeWord: current.searchWholeWord ?? false,
        include: parseGlobs(current.searchInclude),
        exclude: parseGlobs(current.searchExclude),
      }, signal)
      if (gen !== searchGen.current) return
      const multiRoot = folders.length > 1
      const items = page.items.map((h, i) =>
        searchHitToListItem(
          h.result,
          i,
          h.folder.root.path,
          multiRoot ? h.folder.root.name : undefined,
        ),
      )
      patchDoc({ items, searchLoading: false, searchTruncated: page.truncated })
    } catch (err) {
      if (gen !== searchGen.current) return
      if (signal.aborted) return
      patchDoc({
        searchLoading: false,
        searchError: err instanceof Error ? err.message : String(err),
      })
    }
  }, [workspace, listId, patchDoc, getSearchFolders])
  const runSearchRef = useRef(runSearch)
  runSearchRef.current = runSearch

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void runSearchRef.current(controller.signal)
    }, 120)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [
    doc.searchQuery,
    doc.searchCaseSensitive,
    doc.searchRegex,
    doc.searchFuzzy,
    doc.searchWholeWord,
    doc.searchInclude,
    doc.searchExclude,
  ])

  const header = (
    <div className="flex shrink-0 flex-col gap-2 border-b border-border p-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={`search-input-${listId}`}
          autoFocus={autoFocus}
          ref={element => {
            searchInputRef.current = element
            autoFocusInputRef(element)
          }}
          type="search"
          value={doc.searchQuery ?? ""}
          onChange={e => patchDoc({ searchQuery: e.target.value })}
          onKeyDown={event => {
            if (event.key === "Escape" && onDismiss) {
              event.preventDefault()
              onDismiss()
              return
            }
            if (event.key === "ArrowDown") {
              event.preventDefault()
              focusListPanel(listId, "focusFirstItem")
              return
            }
            if (event.key === "Enter" && doc.items[0]) {
              event.preventDefault()
              onOpenItem(doc.items[0])
            }
          }}
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
            ...(doc.searchWholeWord ? ["word"] : []),
          ]}
          onValueChange={values => {
            const fuzzy = values.includes("fuzzy")
            patchDoc({
              searchCaseSensitive: values.includes("case"),
              searchRegex: fuzzy ? false : values.includes("regex"),
              searchFuzzy: fuzzy,
              searchWholeWord: values.includes("word"),
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
          <ToggleGroupItem value="word" className="h-7 px-2 text-xs">
            Whole
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
      <div className="grid grid-cols-2 gap-2">
        <Input
          aria-label="Files to include"
          placeholder="Include: src/**, packages/**"
          value={doc.searchInclude ?? ""}
          onChange={event => patchDoc({ searchInclude: event.target.value })}
          className="h-7 font-mono text-xs"
          spellCheck={false}
        />
        <Input
          aria-label="Files to exclude"
          placeholder="Exclude: **/*.test.ts"
          value={doc.searchExclude ?? ""}
          onChange={event => patchDoc({ searchExclude: event.target.value })}
          className="h-7 font-mono text-xs"
          spellCheck={false}
        />
      </div>
      {doc.searchTruncated ? (
        <p className="text-xs text-muted-foreground" role="status">
          Showing the first 200 matches. Refine the query to see more.
        </p>
      ) : null}
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
      emptyDescription={
        (doc.searchQuery ?? "").trim()
          ? "Try another query."
          : "Type to search across the project."
      }
      header={header}
      onKeyDownCapture={event => {
        const target = event.target
        if (
          target instanceof HTMLElement &&
          target.closest("button, input, select, textarea, [contenteditable='true']")
        ) {
          return
        }
        if (event.key === "Escape" && onDismiss) {
          event.preventDefault()
          onDismiss()
          return
        }
        if (
          event.key.length === 1 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey
        ) {
          event.preventDefault()
          searchInputRef.current?.focus()
          patchDoc({ searchQuery: `${doc.searchQuery ?? ""}${event.key}` })
          return
        }
        if (event.key === "Backspace") {
          event.preventDefault()
          searchInputRef.current?.focus()
          patchDoc({ searchQuery: (doc.searchQuery ?? "").slice(0, -1) })
        }
      }}
    />
  )
}
