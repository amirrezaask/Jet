import type { ListItem, WorkspaceService } from "@yaade/workspace"
import { useCallback, useSyncExternalStore } from "react"
import { LocationList } from "./LocationList.js"

export function DiagnosticsLocationList({
  listId,
  workspace,
  onOpenItem,
}: {
  listId: string
  workspace: WorkspaceService
  onOpenItem: (item: ListItem) => void
}) {
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
  const doc = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  if (!doc) return null

  const errors = doc.items.filter(i => i.detail === "error").length
  const warnings = doc.items.filter(i => i.detail === "warning").length
  const header =
    doc.items.length > 0 ? (
      <div className="shrink-0 border-b border-border px-2 py-1.5 text-xs text-muted-foreground">
        {errors > 0 ? `${errors} error${errors === 1 ? "" : "s"}` : null}
        {errors > 0 && warnings > 0 ? " · " : null}
        {warnings > 0 ? `${warnings} warning${warnings === 1 ? "" : "s"}` : null}
      </div>
    ) : null

  return (
    <LocationList
      listId={listId}
      items={doc.items}
      onOpenItem={onOpenItem}
      emptyTitle="No problems"
      emptyDescription="No diagnostics in the workspace."
      header={header}
    />
  )
}
