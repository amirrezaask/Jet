import type { ListDocument, ListItem, WorkspaceService } from "@jet/workspace"
import { useEffect, useState } from "react"
import { LocationList } from "./LocationList.js"

function useListDocument(listId: string, workspace: WorkspaceService): ListDocument | undefined {
  const [, setRev] = useState(0)
  useEffect(() => {
    return workspace.listStore.onDidChange.event(e => {
      if (e.id === listId) setRev(r => r + 1)
    }).dispose
  }, [workspace, listId])
  return workspace.listStore.get(listId)
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
    />
  )
}
