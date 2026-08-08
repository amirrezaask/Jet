import type { ListDocument, ListItem, WorkspaceService } from "@yaade/workspace"
import { useCallback, useSyncExternalStore } from "react"
import { LocationList } from "./LocationList.js"

function useListDocument(listId: string, workspace: WorkspaceService): ListDocument | undefined {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const disposable = workspace.listStore.onDidChange.event(event => {
        if (event.id === listId) onStoreChange()
      })
      return () => disposable.dispose()
    },
    [listId, workspace],
  )
  const getSnapshot = useCallback(
    () => workspace.listStore.get(listId),
    [listId, workspace],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function ReferencesLocationList({
  listId,
  workspace,
  onOpenItem,
}: {
  listId: string
  workspace: WorkspaceService
  onOpenItem: (item: ListItem) => void
}) {
  const doc = useListDocument(listId, workspace)
  if (!doc) return null

  const header = (
    <div className="shrink-0 border-b border-border px-2 py-1.5 text-xs text-muted-foreground">
      {doc.title}
    </div>
  )

  return (
    <LocationList
      listId={listId}
      items={doc.items}
      onOpenItem={onOpenItem}
      emptyTitle="No references"
      emptyDescription="No reference locations found for this symbol."
      header={header}
      feed="references"
    />
  )
}

export function DefinitionsLocationList({
  listId,
  workspace,
  onOpenItem,
}: {
  listId: string
  workspace: WorkspaceService
  onOpenItem: (item: ListItem) => void
}) {
  const doc = useListDocument(listId, workspace)
  if (!doc) return null

  const header = (
    <div className="shrink-0 border-b border-border px-2 py-1.5 text-xs text-muted-foreground">
      {doc.title}
    </div>
  )

  return (
    <LocationList
      listId={listId}
      items={doc.items}
      onOpenItem={onOpenItem}
      emptyTitle="No definitions"
      emptyDescription="No definition locations found."
      header={header}
      feed="definitions"
    />
  )
}
