import type { ListItem, WorkspaceService } from "@gharargah/workspace"
import { useEffect, useState } from "react"
import { LocationList } from "./LocationList.js"

export function TaskErrorsLocationList({
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

  const statusLabel =
    doc.taskStatus === "running"
      ? "Running…"
      : doc.taskStatus === "failed"
        ? "Failed"
        : doc.taskStatus === "done"
          ? "Done"
          : ""

  const header = (
    <div className="shrink-0 border-b border-border px-2 py-1.5 text-xs text-muted-foreground">
      {doc.taskLabel ?? doc.title}
      {statusLabel ? ` · ${statusLabel}` : ""}
    </div>
  )

  return (
    <LocationList
      listId={listId}
      items={doc.items}
      onOpenItem={onOpenItem}
      emptyTitle="No task errors"
      emptyDescription="The task completed without parseable error locations."
      header={header}
    />
  )
}
