import type { ListItem, WorkspaceService } from "@jet/workspace"
import { SidebarProvider } from "@/components/ui/sidebar.js"
import { LocationList } from "./LocationList.js"
import { SearchLocationList } from "./SearchLocationList.js"
import {
  DefinitionsLocationList,
  ReferencesLocationList,
} from "./ReferencesLocationList.js"
import { DiagnosticsLocationList } from "./DiagnosticsLocationList.js"
import { TaskErrorsLocationList } from "./TaskErrorsLocationList.js"

export function ListPanelBody({
  listId,
  workspace,
  onOpenItem,
}: {
  listId: string
  workspace: WorkspaceService
  onOpenItem: (item: ListItem) => void
}) {
  const doc = workspace.listStore.get(listId)
  if (!doc) {
    return (
      <LocationList
        listId={listId}
        items={[]}
        onOpenItem={onOpenItem}
        emptyTitle="List unavailable"
        emptyDescription="This list tab was closed or is no longer loaded."
      />
    )
  }

  const inner = (() => {
    switch (doc.feed) {
      case "search":
        return (
          <SearchLocationList listId={listId} workspace={workspace} onOpenItem={onOpenItem} />
        )
      case "references":
        return (
          <ReferencesLocationList listId={listId} workspace={workspace} onOpenItem={onOpenItem} />
        )
      case "definitions":
        return (
          <DefinitionsLocationList listId={listId} workspace={workspace} onOpenItem={onOpenItem} />
        )
      case "problems":
        return (
          <DiagnosticsLocationList listId={listId} workspace={workspace} onOpenItem={onOpenItem} />
        )
      case "task-errors":
        return (
          <TaskErrorsLocationList listId={listId} workspace={workspace} onOpenItem={onOpenItem} />
        )
      default:
        return (
          <LocationList
            listId={listId}
            items={doc.items}
            onOpenItem={onOpenItem}
          />
        )
    }
  })()

  return (
    <SidebarProvider className="!min-h-0 flex h-full min-h-0 flex-1 flex-col text-sidebar-foreground">
      {inner}
    </SidebarProvider>
  )
}
