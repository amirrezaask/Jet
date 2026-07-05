import type { ListItem, WorkspaceService } from "@jet/workspace"
import { useEffect, useState } from "react"
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
  const [, setRev] = useState(0)
  useEffect(() => {
    return workspace.listStore.onDidChange.event(e => {
      if (e.id === listId) setRev(r => r + 1)
    }).dispose
  }, [workspace, listId])

  const doc = workspace.listStore.get(listId)
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
